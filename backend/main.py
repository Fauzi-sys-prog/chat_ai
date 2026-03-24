from contextlib import asynccontextmanager
import hashlib
import io
import json
import math
import os
import re
import secrets
import smtplib
import threading
import time
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import AsyncIterator, Generator, Literal
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.responses import PlainTextResponse, StreamingResponse
from openai import APIConnectionError, AuthenticationError, BadRequestError, NotFoundError, OpenAI, RateLimitError
from pydantic import BaseModel, EmailStr
from pypdf import PdfReader
from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    create_engine,
    inspect,
    select,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker

try:
    from google.auth.transport.requests import Request as GoogleRequest
    from google.oauth2 import id_token as google_id_token
except Exception:
    GoogleRequest = None
    google_id_token = None

backend_env_path = Path(__file__).with_name(".env")
root_env_path = Path(__file__).resolve().parent.parent / ".env.local"

if backend_env_path.exists():
    load_dotenv(dotenv_path=backend_env_path)
elif root_env_path.exists():
    load_dotenv(dotenv_path=root_env_path)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def normalize_database_url(raw_url: str) -> str:
    if raw_url.startswith("postgresql://"):
        return raw_url.replace("postgresql://", "postgresql+psycopg://", 1)
    if raw_url.startswith("sqlite:///"):
        db_path = raw_url.removeprefix("sqlite:///")
        if not db_path.startswith("/"):
            db_file = Path(__file__).resolve().parent.parent / db_path
            db_file.parent.mkdir(parents=True, exist_ok=True)
            return f"sqlite:///{db_file}"
    return raw_url


database_url = normalize_database_url(os.getenv("DATABASE_URL", "sqlite:///backend/app.db"))
engine = create_engine(
    database_url,
    connect_args={"check_same_thread": False} if database_url.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
AUTO_MANAGE_SCHEMA = database_url.startswith("sqlite")

auth_rate_limit_state: dict[str, list[float]] = {}
auth_rate_limit_lock = threading.Lock()
email_job_worker_started = False


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    start_email_job_worker()
    yield


app = FastAPI(title="Chat AI Python Backend", lifespan=lifespan)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid4()))
    name: Mapped[str] = mapped_column(String(160))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    sessions: Mapped[list["AuthSession"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    conversations: Mapped[list["Conversation"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    owned_workspaces: Mapped[list["Workspace"]] = relationship(
        back_populates="owner", cascade="all, delete-orphan"
    )
    workspace_memberships: Mapped[list["WorkspaceMember"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class Workspace(Base):
    __tablename__ = "workspaces"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid4()))
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(160))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    owner: Mapped[User] = relationship(back_populates="owned_workspaces")
    members: Mapped[list["WorkspaceMember"]] = relationship(
        back_populates="workspace", cascade="all, delete-orphan"
    )
    conversations: Mapped[list["Conversation"]] = relationship(
        back_populates="workspace", cascade="all, delete-orphan"
    )


class WorkspaceMember(Base):
    __tablename__ = "workspace_members"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(24), default="member")
    department: Mapped[str | None] = mapped_column(String(120), nullable=True)
    cost_center: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    workspace: Mapped[Workspace] = relationship(back_populates="members")
    user: Mapped[User] = relationship(back_populates="workspace_memberships")


class WorkspaceInviteRequest(Base):
    __tablename__ = "workspace_invites"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid4()))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    email: Mapped[str] = mapped_column(String(255), index=True)
    role: Mapped[str] = mapped_column(String(24), default="member")
    token: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    status: Mapped[str] = mapped_column(String(24), default="pending", index=True)
    invited_by_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class WorkspaceSubscription(Base):
    __tablename__ = "workspace_subscriptions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid4()))
    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), unique=True, index=True
    )
    provider: Mapped[str] = mapped_column(String(32), default="stripe")
    plan_name: Mapped[str] = mapped_column(String(120), default="Pro Team")
    status: Mapped[str] = mapped_column(String(32), default="inactive")
    stripe_customer_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    stripe_subscription_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    seats_included: Mapped[int] = mapped_column(Integer, default=1)
    base_price_usd: Mapped[float] = mapped_column(Float, default=19.0)
    seat_price_usd: Mapped[float] = mapped_column(Float, default=12.0)
    monthly_token_quota: Mapped[int] = mapped_column(Integer, default=200000)
    monthly_document_quota: Mapped[int] = mapped_column(Integer, default=200)
    cancel_at_period_end: Mapped[bool] = mapped_column(Boolean, default=False)
    current_period_end: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: utc_now() + timedelta(days=30)
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class WorkspaceDepartmentBudget(Base):
    __tablename__ = "workspace_department_budgets"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid4()))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    department: Mapped[str] = mapped_column(String(120), index=True)
    monthly_budget_usd: Mapped[float] = mapped_column(Float, default=0.0)
    alert_threshold_ratio: Mapped[float] = mapped_column(Float, default=0.8)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class EmailDeliveryJob(Base):
    __tablename__ = "email_delivery_jobs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid4()))
    workspace_id: Mapped[str | None] = mapped_column(
        ForeignKey("workspaces.id", ondelete="SET NULL"), nullable=True, index=True
    )
    related_invite_id: Mapped[str | None] = mapped_column(
        ForeignKey("workspace_invites.id", ondelete="SET NULL"), nullable=True
    )
    email_type: Mapped[str] = mapped_column(String(64), default="workspace_invite")
    recipient_email: Mapped[str] = mapped_column(String(255), index=True)
    subject: Mapped[str] = mapped_column(String(255))
    body_text: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(24), default="pending", index=True)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    processing_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    worker_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class WorkspaceApiKey(Base):
    __tablename__ = "workspace_api_keys"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid4()))
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    created_by_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    label: Mapped[str] = mapped_column(String(160))
    key_prefix: Mapped[str] = mapped_column(String(24), index=True)
    key_hash: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    status: Mapped[str] = mapped_column(String(24), default="active", index=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class RequestLog(Base):
    __tablename__ = "request_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_id: Mapped[str | None] = mapped_column(
        ForeignKey("workspaces.id", ondelete="SET NULL"), nullable=True, index=True
    )
    user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    api_key_id: Mapped[str | None] = mapped_column(
        ForeignKey("workspace_api_keys.id", ondelete="SET NULL"), nullable=True, index=True
    )
    method: Mapped[str] = mapped_column(String(12), index=True)
    path: Mapped[str] = mapped_column(String(255), index=True)
    status_code: Mapped[int] = mapped_column(Integer, index=True)
    duration_ms: Mapped[int] = mapped_column(Integer)
    auth_mode: Mapped[str | None] = mapped_column(String(24), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid4()))
    token: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    user: Mapped[User] = relationship(back_populates="sessions")


class AuthActionToken(Base):
    __tablename__ = "auth_action_tokens"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    purpose: Mapped[str] = mapped_column(String(32), index=True)
    status: Mapped[str] = mapped_column(String(24), default="pending", index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid4()))
    workspace_id: Mapped[str | None] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=True
    )
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(160), default="Chat baru")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    user: Mapped[User] = relationship(back_populates="conversations")
    workspace: Mapped[Workspace | None] = relationship(back_populates="conversations")
    messages: Mapped[list["Message"]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan", order_by="Message.created_at"
    )
    documents: Mapped[list["Document"]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan", order_by="Document.created_at"
    )


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"))
    role: Mapped[str] = mapped_column(String(16))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    conversation: Mapped[Conversation] = relationship(back_populates="messages")


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_id: Mapped[str | None] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=True, index=True
    )
    conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(255))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    conversation: Mapped[Conversation] = relationship(back_populates="documents")
    chunks: Mapped[list["DocumentChunk"]] = relationship(
        back_populates="document", cascade="all, delete-orphan", order_by="DocumentChunk.position"
    )


class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"))
    position: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(Text)
    embedding_json: Mapped[str] = mapped_column(Text)
    norm: Mapped[float] = mapped_column(Float)

    document: Mapped[Document] = relationship(back_populates="chunks")


class UsageEvent(Base):
    __tablename__ = "usage_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    workspace_id: Mapped[str | None] = mapped_column(
        ForeignKey("workspaces.id", ondelete="SET NULL"), nullable=True, index=True
    )
    conversation_id: Mapped[str | None] = mapped_column(
        ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True
    )
    event_type: Mapped[str] = mapped_column(String(64), index=True)
    tokens_estimate: Mapped[int] = mapped_column(Integer, default=0)
    cost_estimate_usd: Mapped[float] = mapped_column(Float, default=0.0)
    metadata_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_id: Mapped[str | None] = mapped_column(
        ForeignKey("workspaces.id", ondelete="SET NULL"), nullable=True, index=True
    )
    actor_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    action: Mapped[str] = mapped_column(String(64), index=True)
    target_type: Mapped[str] = mapped_column(String(64))
    target_value: Mapped[str] = mapped_column(String(255))
    metadata_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


if AUTO_MANAGE_SCHEMA:
    Base.metadata.create_all(bind=engine)


def ensure_schema() -> None:
    inspector = inspect(engine)
    user_columns = (
        {column["name"] for column in inspector.get_columns("users")}
        if inspector.has_table("users")
        else set()
    )
    conversation_columns = {column["name"] for column in inspector.get_columns("conversations")}
    usage_event_columns = {column["name"] for column in inspector.get_columns("usage_events")}
    chunk_columns = {column["name"] for column in inspector.get_columns("document_chunks")}
    document_columns = {column["name"] for column in inspector.get_columns("documents")}
    subscription_columns = (
        {column["name"] for column in inspector.get_columns("workspace_subscriptions")}
        if inspector.has_table("workspace_subscriptions")
        else set()
    )
    workspace_member_columns = (
        {column["name"] for column in inspector.get_columns("workspace_members")}
        if inspector.has_table("workspace_members")
        else set()
    )
    email_job_columns = (
        {column["name"] for column in inspector.get_columns("email_delivery_jobs")}
        if inspector.has_table("email_delivery_jobs")
        else set()
    )
    request_log_columns = (
        {column["name"] for column in inspector.get_columns("request_logs")}
        if inspector.has_table("request_logs")
        else set()
    )

    with engine.begin() as connection:
        if inspector.has_table("users") and "email_verified" not in user_columns:
            connection.execute(
                text("ALTER TABLE users ADD COLUMN email_verified BOOLEAN DEFAULT 0")
            )
        if "workspace_id" not in conversation_columns:
            connection.execute(text("ALTER TABLE conversations ADD COLUMN workspace_id VARCHAR(64)"))
        if "workspace_id" not in usage_event_columns:
            connection.execute(text("ALTER TABLE usage_events ADD COLUMN workspace_id VARCHAR(64)"))
        if "workspace_id" not in document_columns:
            connection.execute(text("ALTER TABLE documents ADD COLUMN workspace_id VARCHAR(64)"))
        if inspector.has_table("workspace_subscriptions"):
            if "monthly_token_quota" not in subscription_columns:
                connection.execute(
                    text(
                        "ALTER TABLE workspace_subscriptions ADD COLUMN monthly_token_quota INTEGER DEFAULT 200000"
                    )
                )
            if "monthly_document_quota" not in subscription_columns:
                connection.execute(
                    text(
                        "ALTER TABLE workspace_subscriptions ADD COLUMN monthly_document_quota INTEGER DEFAULT 200"
                    )
                )
        if inspector.has_table("workspace_members"):
            if "department" not in workspace_member_columns:
                connection.execute(
                    text("ALTER TABLE workspace_members ADD COLUMN department VARCHAR(120) NULL")
                )
            if "cost_center" not in workspace_member_columns:
                connection.execute(
                    text("ALTER TABLE workspace_members ADD COLUMN cost_center VARCHAR(120) NULL")
                )
        if inspector.has_table("email_delivery_jobs"):
            if "attempt_count" not in email_job_columns:
                connection.execute(
                    text("ALTER TABLE email_delivery_jobs ADD COLUMN attempt_count INTEGER DEFAULT 0")
                )
            if "processing_started_at" not in email_job_columns:
                connection.execute(
                    text(
                        "ALTER TABLE email_delivery_jobs ADD COLUMN processing_started_at TIMESTAMP NULL"
                    )
                )
            if "processed_at" not in email_job_columns:
                connection.execute(
                    text("ALTER TABLE email_delivery_jobs ADD COLUMN processed_at TIMESTAMP NULL")
                )
            if "worker_name" not in email_job_columns:
                connection.execute(
                    text("ALTER TABLE email_delivery_jobs ADD COLUMN worker_name VARCHAR(120) NULL")
                )
        if inspector.has_table("request_logs") and "auth_mode" not in request_log_columns:
            connection.execute(text("ALTER TABLE request_logs ADD COLUMN auth_mode VARCHAR(24) NULL"))
        try:
            connection.execute(
                text(
                    """
                    UPDATE documents
                    SET workspace_id = (
                        SELECT conversations.workspace_id
                        FROM conversations
                        WHERE conversations.id = documents.conversation_id
                    )
                    WHERE workspace_id IS NULL
                    """
                )
            )
        except Exception:
            pass
        if USE_NATIVE_PGVECTOR and "embedding_vector" not in chunk_columns:
            try:
                connection.execute(
                    text("ALTER TABLE document_chunks ADD COLUMN embedding_vector vector(1536)")
                )
            except Exception:
                pass


class UserOut(BaseModel):
    id: str
    name: str
    email: str
    email_verified: bool


class AuthPayload(BaseModel):
    name: str | None = None
    email: EmailStr
    password: str


class AuthResponse(BaseModel):
    token: str
    user: UserOut


class AuthProviderStatus(BaseModel):
    enabled: bool
    label: str
    description: str
    reason: str | None = None


class AuthProvidersResponse(BaseModel):
    email_password: AuthProviderStatus
    google: AuthProviderStatus


class GoogleAuthPayload(BaseModel):
    credential: str


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirm(BaseModel):
    password: str


class AuthActionTokenOut(BaseModel):
    email: str
    purpose: str
    status: str
    expires_at: str


class MessageOut(BaseModel):
    id: int
    role: Literal["user", "assistant"]
    content: str
    created_at: str


class DocumentOut(BaseModel):
    id: int
    name: str
    created_at: str
    chunk_count: int


class WorkspaceDocumentOut(BaseModel):
    id: int
    name: str
    created_at: str
    chunk_count: int
    conversation_id: str
    conversation_title: str


class ConversationSummary(BaseModel):
    id: str
    title: str
    updated_at: str
    message_count: int
    document_count: int


class ConversationDetail(BaseModel):
    id: str
    title: str
    updated_at: str
    messages: list[MessageOut]
    documents: list[DocumentOut]


class ConversationCreate(BaseModel):
    title: str | None = None


class ChatCreate(BaseModel):
    content: str


class AnalyticsOverview(BaseModel):
    conversation_count: int
    document_count: int
    message_count: int
    assistant_message_count: int
    total_chunks: int
    total_usage_events: int
    estimated_total_tokens: int
    estimated_prompt_tokens: int
    estimated_completion_tokens: int
    estimated_total_cost_usd: float
    estimated_prompt_cost_usd: float
    estimated_completion_cost_usd: float
    chats_sent: int
    documents_uploaded: int


class WorkspaceMemberOut(BaseModel):
    email: str
    name: str
    role: str
    department: str | None = None
    cost_center: str | None = None


class WorkspaceOut(BaseModel):
    id: str
    name: str
    role: str
    member_count: int


class WorkspaceDetail(BaseModel):
    id: str
    name: str
    role: str
    members: list[WorkspaceMemberOut]


class WorkspaceCreate(BaseModel):
    name: str


class WorkspaceInvite(BaseModel):
    email: EmailStr
    role: str = "member"


class WorkspaceRoleUpdate(BaseModel):
    role: str


class WorkspaceMemberMetadataUpdate(BaseModel):
    department: str | None = None
    cost_center: str | None = None


class WorkspaceInviteOut(BaseModel):
    id: str
    workspace_id: str
    workspace_name: str
    email: str
    role: str
    status: str
    token: str
    accept_url: str
    created_at: str


class PublicWorkspaceInviteOut(BaseModel):
    workspace_name: str
    email: str
    role: str
    status: str
    accept_url: str
    created_at: str


class WorkspaceInvitationActionOut(BaseModel):
    ok: bool
    status: str
    workspace_id: str
    workspace_name: str


class WorkspaceMemberUsageOut(BaseModel):
    email: str
    name: str
    role: str
    department: str | None = None
    cost_center: str | None = None
    estimated_total_tokens: int
    estimated_total_cost_usd: float
    chats_sent: int
    documents_uploaded: int


class WorkspaceSettingsOut(BaseModel):
    workspace_id: str
    workspace_name: str
    plan_name: str
    seats_included: int
    base_price_usd: float
    seat_price_usd: float
    monthly_token_quota: int
    monthly_document_quota: int
    smtp_enabled: bool
    department_budgets: list["WorkspaceDepartmentBudgetOut"]


class WorkspaceDepartmentBudgetOut(BaseModel):
    id: str
    department: str
    monthly_budget_usd: float
    alert_threshold_ratio: float
    created_at: str
    updated_at: str


class WorkspaceDepartmentBudgetUpsert(BaseModel):
    department: str
    monthly_budget_usd: float
    alert_threshold_ratio: float = 0.8


class WorkspaceSettingsUpdate(BaseModel):
    plan_name: str | None = None
    seats_included: int | None = None
    base_price_usd: float | None = None
    seat_price_usd: float | None = None
    monthly_token_quota: int | None = None
    monthly_document_quota: int | None = None


class WorkspaceApiKeyCreate(BaseModel):
    label: str


class WorkspaceApiKeyOut(BaseModel):
    id: str
    label: str
    key_prefix: str
    status: str
    last_used_at: str | None = None
    created_at: str


class WorkspaceApiKeyCreateOut(BaseModel):
    api_key: str
    item: WorkspaceApiKeyOut


class EmailDeliveryJobOut(BaseModel):
    id: str
    recipient_email: str
    email_type: str
    status: str
    attempt_count: int
    subject: str
    error_message: str | None = None
    sent_at: str | None = None
    processing_started_at: str | None = None
    processed_at: str | None = None
    worker_name: str | None = None
    created_at: str


class WorkspaceApiKeyUsageOut(BaseModel):
    id: str
    label: str
    key_prefix: str
    status: str
    request_count: int
    billable_request_count: int
    estimated_tokens: int
    estimated_cost_usd: float
    last_used_at: str | None = None
    last_path: str | None = None
    top_paths: list[str]


class WorkspaceObservabilityOut(BaseModel):
    workspace_id: str
    total_requests: int
    error_requests: int
    avg_duration_ms: int
    last_request_at: str | None = None
    top_paths: list[str]
    auth_mode_breakdown: dict[str, int]
    recent_errors: list[str]


class AdminUserAnalytics(BaseModel):
    email: str
    name: str
    conversation_count: int
    document_count: int
    estimated_total_tokens: int
    estimated_total_cost_usd: float


class AdminAnalyticsOverview(BaseModel):
    user_count: int
    conversation_count: int
    document_count: int
    message_count: int
    usage_event_count: int
    estimated_total_tokens: int
    estimated_total_cost_usd: float
    top_users: list[AdminUserAnalytics]


class WorkspaceBillingSummary(BaseModel):
    workspace_id: str
    workspace_name: str
    member_count: int
    estimated_total_tokens: int
    estimated_total_cost_usd: float
    chats_sent: int
    documents_uploaded: int


class RequestLogEntryOut(BaseModel):
    id: int
    method: str
    path: str
    status_code: int
    duration_ms: int
    auth_mode: str | None = None
    user_email: str | None = None
    api_key_label: str | None = None
    created_at: str


class RequestLogPageOut(BaseModel):
    items: list[RequestLogEntryOut]
    total: int
    limit: int
    offset: int
    next_offset: int | None = None
    previous_offset: int | None = None


class WorkspaceInvoiceLineItemOut(BaseModel):
    label: str
    amount_usd: float
    quantity: int | float
    unit: str


class WorkspaceInvoiceMemberOut(BaseModel):
    email: str
    name: str
    role: str
    department: str | None = None
    cost_center: str | None = None
    token_usage: int
    estimated_usage_cost_usd: float
    chats_sent: int
    documents_uploaded: int


class WorkspaceDepartmentBudgetAlertOut(BaseModel):
    department: str
    monthly_budget_usd: float
    spend_usd: float
    utilization_ratio: float
    member_count: int
    status: str
    alert_threshold_ratio: float


class WorkspaceInvoiceSummaryOut(BaseModel):
    workspace_id: str
    workspace_name: str
    period_label: str
    period_start: str
    period_end: str
    currency: str
    seats_in_use: int
    seats_included: int
    token_usage: int
    document_uploads: int
    request_count: int
    api_key_request_count: int
    estimated_usage_cost_usd: float
    subtotal_usd: float
    total_usd: float
    line_items: list[WorkspaceInvoiceLineItemOut]
    member_breakdown: list[WorkspaceInvoiceMemberOut]
    department_alerts: list[WorkspaceDepartmentBudgetAlertOut]


class AuditLogOut(BaseModel):
    id: int
    action: str
    target_type: str
    target_value: str
    metadata_json: str
    metadata: dict
    actor_email: str | None = None
    created_at: str


class EmailWorkerStatusOut(BaseModel):
    worker_enabled: bool
    worker_running: bool
    queue_depth: int
    processing_jobs: int
    failed_jobs: int
    last_processed_at: str | None = None


class WorkspaceSubscriptionSummary(BaseModel):
    workspace_id: str
    provider: str
    plan_name: str
    status: str
    current_period_end: str
    seats_in_use: int
    seats_included: int
    stripe_customer_id: str | None = None
    stripe_subscription_id: str | None = None
    cancel_at_period_end: bool
    monthly_token_quota: int
    monthly_document_quota: int
    quota_tokens_used: int
    quota_documents_used: int
    estimated_monthly_cost_usd: float


class StripeWebhookPayload(BaseModel):
    event_type: str
    workspace_id: str
    status: str | None = None
    stripe_customer_id: str | None = None
    stripe_subscription_id: str | None = None
    cancel_at_period_end: bool | None = None
    current_period_end: str | None = None


STARTER_MESSAGE = (
    "Hello, I am ready to help. I can answer general questions, refine ideas, or analyze workspace documents if you upload relevant PDF or text files."
)
SYSTEM_PROMPT = (
    "You are the Building Plan Automation Workspace assistant, a hybrid work assistant that combines general-purpose AI with a project knowledge workspace. "
    "Use a professional, calm, clear, and concise tone similar to a premium AI assistant. "
    "Answer in English unless the user explicitly asks for another language. "
    "Prioritize responses that are directly useful, well structured, and easy to scan. "
    "Aim for polished, natural, and credible answers without sounding stiff. "
    "Avoid jokes, slang, or overly casual language unless the user explicitly asks for it. "
    "You may help with brainstorming, writing, summarization, concept explanation, and general questions even without documents. "
    "If project documents are available, prioritize that context over general knowledge. "
    "Do not invent internal facts, SOPs, policies, figures, or decisions that are not present in the workspace documents. "
    "If the question is general and does not require internal data, you may answer from general knowledge. "
    "If the answer is not based on workspace documents, say that briefly and professionally, for example "
    "'Based on general knowledge' or 'I have not found a specific reference in the workspace documents yet.' "
    "If the user requests internal information but the supporting documents are not available, say honestly that the workspace reference was not found and suggest uploading the relevant document if needed. "
    "If there is uncertainty, say so honestly and do not sound falsely confident. "
    "When a richer answer would be more useful, adaptively include core context, key points, practical examples, risks or checks, and next steps. "
    "Do not provide generic answers when a stronger one is possible; make the response substantive, work-relevant, and decision-friendly. "
    "For simple questions, answer in one to three short paragraphs without unnecessary structure. "
    "For complex questions, start with the core answer first, then add sections such as 'Key points' or 'Next steps' only when helpful. "
    "For deeper analysis, recommendations, or explanations, use the order: core answer, key points, then next steps when relevant. "
    "Use bullet points only when they clearly improve readability, and avoid long lists when short paragraphs are enough. "
    "If the user asks for something actionable, suggest concrete and concise next steps. "
    "When explaining, prioritize clarity and practical decisions over long theory. "
    "Use the following response patterns adaptively based on the user's request. "
    "For document summaries, use: Short summary, then Key points. "
    "For SOP, policy, or internal rule lookup, use: Main findings, then Workspace references if available, then Gap note if the document is not found. "
    "For action items or work plans, use: Short objective, then concrete and ordered next steps. "
    "For general non-document answers, use a short paragraph that answers directly, with a brief note that it comes from general knowledge when relevant. "
    "For concept explanations, use: core concept first, then a practical example or work implication when helpful. "
    "Do not write longer than necessary when a concise answer will do."
)
EMBEDDING_MODEL = os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")
SESSION_TTL_DAYS = int(os.getenv("SESSION_TTL_DAYS", "14"))
APP_BASE_URL = os.getenv("APP_BASE_URL", "http://localhost:3000").rstrip("/")
SMTP_HOST = os.getenv("SMTP_HOST", "").strip()
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USERNAME = os.getenv("SMTP_USERNAME", "").strip()
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "").strip()
SMTP_FROM_EMAIL = os.getenv("SMTP_FROM_EMAIL", SMTP_USERNAME or "noreply@example.com").strip()
SMTP_FROM_NAME = os.getenv("SMTP_FROM_NAME", "Chat AI Workspace").strip()
SMTP_USE_TLS = os.getenv("SMTP_USE_TLS", "1") == "1"
EMAIL_VERIFICATION_TTL_HOURS = int(os.getenv("EMAIL_VERIFICATION_TTL_HOURS", "48"))
PASSWORD_RESET_TTL_HOURS = int(os.getenv("PASSWORD_RESET_TTL_HOURS", "2"))
AUTH_RATE_LIMIT_WINDOW_SECONDS = int(os.getenv("AUTH_RATE_LIMIT_WINDOW_SECONDS", "900"))
AUTH_RATE_LIMIT_MAX_ATTEMPTS = int(os.getenv("AUTH_RATE_LIMIT_MAX_ATTEMPTS", "8"))
AUTO_PROCESS_EMAIL_JOBS = os.getenv("AUTO_PROCESS_EMAIL_JOBS", "0") == "1"
EMAIL_JOB_POLL_SECONDS = int(os.getenv("EMAIL_JOB_POLL_SECONDS", "15"))
EMAIL_JOB_LEASE_SECONDS = int(os.getenv("EMAIL_JOB_LEASE_SECONDS", "120"))
ADMIN_EMAILS = {
    email.strip().lower()
    for email in os.getenv("ADMIN_EMAILS", "").split(",")
    if email.strip()
}
CHAT_INPUT_COST_PER_1K = float(os.getenv("CHAT_INPUT_COST_PER_1K", "0.00015"))
CHAT_OUTPUT_COST_PER_1K = float(os.getenv("CHAT_OUTPUT_COST_PER_1K", "0.0006"))
EMBEDDING_COST_PER_1K = float(os.getenv("EMBEDDING_COST_PER_1K", "0.00002"))
WORKSPACE_MONTHLY_TOKEN_QUOTA = int(os.getenv("WORKSPACE_MONTHLY_TOKEN_QUOTA", "200000"))
WORKSPACE_MONTHLY_DOCUMENT_QUOTA = int(os.getenv("WORKSPACE_MONTHLY_DOCUMENT_QUOTA", "200"))
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "whsec_mock")
USE_NATIVE_PGVECTOR = database_url.startswith("postgresql") and os.getenv("USE_NATIVE_PGVECTOR", "1") == "1"
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "").strip()
ALLOWED_WORKSPACE_ROLES = {"owner", "admin", "member"}
HUMAN_ONLY_ERROR_MESSAGE = "This endpoint requires a direct user login, not a workspace API key."
DEMO_AI_MODE = os.getenv("DEMO_AI_MODE", "auto").strip().lower()

if AUTO_MANAGE_SCHEMA:
    ensure_schema()


def get_openai_client() -> OpenAI:
    api_key = (os.getenv("OPENAI_API_KEY") or "").strip()
    if not api_key or api_key.lower() in {
        "your_openai_api_key_here",
        "sk-your-key",
        "replace_with_real_openai_api_key",
        "sk-....",
    }:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY is not configured.")
    return OpenAI(api_key=api_key)


def demo_ai_enabled() -> bool:
    return DEMO_AI_MODE in {"1", "true", "yes", "on", "auto", "demo"}


def demo_ai_reason(reason: str) -> str:
    return f"Demo mode is active because the live AI service is not currently available ({reason})."


def demo_embedding(text: str, dimensions: int = 1536) -> list[float]:
    seed = text.strip() or "demo"
    values: list[float] = []
    counter = 0
    while len(values) < dimensions:
        digest = hashlib.sha256(f"{seed}:{counter}".encode("utf-8")).digest()
        counter += 1
        for index in range(0, len(digest), 4):
            chunk = digest[index : index + 4]
            if len(chunk) < 4:
                continue
            raw = int.from_bytes(chunk, "big", signed=False)
            values.append((raw / 0xFFFFFFFF) * 2 - 1)
            if len(values) == dimensions:
                break
    return values


def extract_context_blocks(context: str) -> list[tuple[str | None, str]]:
    blocks: list[tuple[str | None, str]] = []
    for raw_block in context.split("\n\n"):
        lines = [line.strip() for line in raw_block.splitlines() if line.strip()]
        if not lines:
            continue
        document_name: str | None = None
        if lines[0].startswith("[Document:"):
            match = re.match(r"\[Document:\s*(.*?)\s*\|", lines[0])
            if match:
                document_name = match.group(1).strip()
            lines = lines[1:]
        content = " ".join(lines).strip()
        if content:
            blocks.append((document_name, content))
    return blocks


def extract_context_highlights(context: str, limit: int = 3) -> list[str]:
    highlights: list[str] = []
    seen: set[str] = set()
    for _, content in extract_context_blocks(context):
        sentence_candidates = re.split(r"(?<=[.!?])\s+|\n+", content)
        for sentence in sentence_candidates:
            cleaned = sentence.strip(" \t-•")
            cleaned = re.sub(r"\s+", " ", cleaned)
            if len(cleaned) < 28:
                continue
            normalized = cleaned.lower()
            if normalized in seen:
                continue
            seen.add(normalized)
            highlights.append(cleaned)
            if len(highlights) >= limit:
                return highlights
    return highlights


def summarize_context_documents(context: str, limit: int = 3) -> str:
    names: list[str] = []
    seen: set[str] = set()
    for document_name, _ in extract_context_blocks(context):
        if not document_name:
            continue
        lowered = document_name.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        names.append(document_name)
        if len(names) >= limit:
            break
    return ", ".join(names)


def build_demo_reply(prompt: str, context: str) -> str:
    cleaned_prompt = prompt.strip()
    lowered = cleaned_prompt.lower()
    context_available = bool(context.strip())
    context_preview = ""
    context_highlights = extract_context_highlights(context, limit=3)
    context_documents = summarize_context_documents(context, limit=3)
    context_highlight_lines = "\n".join(
        f"- {item}" for item in context_highlights
    ) or "- The system found workspace context that is relevant to this request."
    if context_available:
        preview_source = context.replace("\n", " ").strip()
        context_preview = preview_source[:260].strip()

    if context_available:
        intro = "Based on the available workspace documents, here is an initial summary in demo mode."
    else:
        intro = "I am responding in demo mode because the live AI connection is not active right now."

    if any(keyword in lowered for keyword in ["ringkas", "summary", "rangkum"]):
        if context_available:
            return (
                f"{intro}\n\n"
                "Short summary:\n"
                "The available documents appear relevant to your request, and the system has already found context that can be used as a basis for the answer.\n\n"
                "Key points:\n"
                f"{context_highlight_lines}\n\n"
                "Work implications:\n"
                "- The content above is already suitable as an initial summary, briefing input, or basis for internal discussion.\n"
                "- Because this is still demo mode, validate the final wording against the original document before using it operationally.\n"
                "- Once live AI is enabled, this section will automatically become more precise and more context-rich.\n\n"
                f"Workspace references:\n- {context_documents or 'Relevant workspace documents were detected, but the file names were not parsed cleanly.'}\n\n"
                f"Context preview:\n{context_preview}"
            )
        return (
            f"{intro}\n\n"
            "Short summary:\n"
            "There are no workspace documents available yet that can be used as a source for the summary.\n\n"
            "Why this matters:\n"
            "- Without documents, I can only provide general guidance and cannot accurately summarize internal content.\n\n"
            "Next steps:\n"
            "- Upload a relevant PDF or TXT file.\n"
            "- Then ask me to summarize key points, risks, or action items.\n"
            "- You can also start with a general question while the documents are still being prepared."
        )

    if any(keyword in lowered for keyword in ["sop", "kebijakan", "policy", "prosedur"]):
        body = (
            "Main findings:\n"
            "An SOP is typically used to standardize how work is performed so that quality, speed, and compliance remain consistent across the team.\n\n"
            "Key points:\n"
            "A strong SOP improves onboarding, reduces process variation, and makes operational mistakes easier to control.\n\n"
            "Practical examples:\n"
            "- An onboarding SOP helps the team understand the sequence of work, the owner of each step, and the checklist that needs to be completed.\n"
            "- An operations SOP helps keep work consistent even when it is carried out by different people.\n\n"
            "Next steps:\n"
            "- Define the process that needs to be standardized.\n"
            "- Document the core steps, owners, inputs, outputs, and risks.\n"
            "- Validate the draft with the operations team before it is rolled out."
        )
        if context_available:
            body += (
                "\n\nWorkspace references:\n"
                f"- {context_documents or 'Relevant workspace documents were detected successfully.'}\n"
                "- The system detected workspace documents, but this answer is still running in demo mode.\n\n"
                "Important highlights:\n"
                + context_highlight_lines
                + "\n\n"
                f"Context preview:\n{context_preview}"
            )
        else:
            body += "\n\nGap note:\nNo workspace reference was used for this answer."
        return f"{intro}\n\n{body}"

    if any(keyword in lowered for keyword in ["langkah", "action", "rencana", "plan", "to-do", "tindak lanjut"]):
        context_section = ""
        if context_available:
            context_section = (
                "\n\nWorkspace context:\n"
                + context_highlight_lines
            )
        return (
            f"{intro}\n\n"
            "Short objective:\n"
            "Help you move from a question to concrete action.\n\n"
            "Top priorities:\n"
            "- Define the final outcome you want.\n"
            "- Choose the three most important things to execute first.\n"
            "- Make sure each action has an owner, a deadline, and a clear definition of done.\n\n"
            "Next steps:\n"
            "1. Clarify the target outcome.\n"
            "2. Gather the most relevant documents or data.\n"
            "3. Create three to five priority actions with an owner and deadline.\n"
            "4. Validate the list before using it as a final decision."
            f"{context_section}"
        )

    if any(keyword in lowered for keyword in ["jelaskan", "apa itu", "kenapa", "mengapa", "bedanya", "perbedaan"]):
        context_section = ""
        if context_available:
            context_section = (
                "\n\nWorkspace references:\n"
                f"- {context_documents or 'Relevant documents were detected'}\n"
                "Context points:\n"
                + context_highlight_lines
            )
        return (
            f"{intro}\n\n"
            "Short answer:\n"
            "This topic can generally be explained as a working concept that helps teams make decisions more consistently and execute them more clearly.\n\n"
            "Key points:\n"
            "- The main focus is usually the process goal, the workflow, and the outcome that must remain consistent.\n"
            "- Its practical value appears when the concept is used to speed up onboarding, reduce ambiguity, and improve quality control.\n"
            "- In operational contexts, the most important questions are who does what, when, and based on which rule.\n\n"
            "Practical examples:\n"
            "- For operations teams, a good explanation often becomes a checklist, SOP, or day-to-day work decision.\n"
            "- For management teams, the same concept is often used to align expectations and reduce process variation.\n"
            f"{context_section}"
        )

    return (
        f"{intro}\n\n"
        "Short answer:\n"
        "I can still help explain, summarize, or structure an initial workflow even while live AI is not active.\n\n"
        "Key points:\n"
        "- I can provide an initial structured answer, including the main idea, practical examples, and next steps.\n"
        "- The full chat, auth, workspace, and document flows continue to work normally.\n"
        "- Once live AI is active, the response will become richer, more precise, and more contextual.\n\n"
        "Examples of how I can still help:\n"
        "- Explain a work concept in simpler language.\n"
        "- Turn findings into a cleaner action plan.\n"
        "- Summarize documents or surface the most important points for the team.\n\n"
        f"Your request:\n{cleaned_prompt or '-'}"
    )


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def isoformat(value: datetime) -> str:
    return ensure_utc(value).isoformat()


def serialize_user(user: User) -> UserOut:
    return UserOut(id=user.id, name=user.name, email=user.email, email_verified=user.email_verified)


def get_google_provider_status() -> AuthProviderStatus:
    if not GOOGLE_CLIENT_ID:
        return AuthProviderStatus(
            enabled=False,
            label="Google",
            description="Sign in or create an account automatically with Google.",
            reason="Google sign-in is not configured on the backend.",
        )
    if GoogleRequest is None or google_id_token is None:
        return AuthProviderStatus(
            enabled=False,
            label="Google",
            description="Sign in or create an account automatically with Google.",
            reason="The Google Sign-In dependency is not installed on the backend.",
        )
    return AuthProviderStatus(
        enabled=True,
        label="Google",
        description="Google will sign the user in automatically if the account already exists, or create one if it does not.",
    )


def verify_google_credential(credential: str) -> dict:
    provider_status = get_google_provider_status()
    if not provider_status.enabled:
        raise HTTPException(status_code=500, detail=provider_status.reason or "Google sign-in is not ready yet.")

    try:
        token_data = google_id_token.verify_oauth2_token(
            credential,
            GoogleRequest(),
            GOOGLE_CLIENT_ID,
        )
    except Exception as exc:
        raise HTTPException(status_code=401, detail="The Google credential is invalid.") from exc

    email = (token_data.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="The Google account did not provide an email address.")
    if not token_data.get("email_verified", False):
        raise HTTPException(status_code=400, detail="The Google email address is not verified.")
    return token_data


def serialize_message(message: Message) -> MessageOut:
    return MessageOut(
        id=message.id,
        role=message.role,
        content=message.content,
        created_at=isoformat(message.created_at),
    )


def serialize_document(document: Document) -> DocumentOut:
    return DocumentOut(
        id=document.id,
        name=document.name,
        created_at=isoformat(document.created_at),
        chunk_count=len(document.chunks),
    )


def serialize_workspace_document(document: Document) -> WorkspaceDocumentOut:
    return WorkspaceDocumentOut(
        id=document.id,
        name=document.name,
        created_at=isoformat(document.created_at),
        chunk_count=len(document.chunks),
        conversation_id=document.conversation.id,
        conversation_title=document.conversation.title,
    )


def serialize_conversation(conversation: Conversation) -> ConversationSummary:
    return ConversationSummary(
        id=conversation.id,
        title=conversation.title,
        updated_at=isoformat(conversation.updated_at),
        message_count=len(conversation.messages),
        document_count=len(conversation.documents),
    )


def serialize_conversation_detail(conversation: Conversation) -> ConversationDetail:
    return ConversationDetail(
        id=conversation.id,
        title=conversation.title,
        updated_at=isoformat(conversation.updated_at),
        messages=[serialize_message(message) for message in conversation.messages],
        documents=[serialize_document(document) for document in conversation.documents],
    )


def hash_password(password: str, salt: str | None = None) -> str:
    actual_salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        actual_salt.encode("utf-8"),
        120000,
    ).hex()
    return f"{actual_salt}${digest}"


def verify_password(password: str, stored_hash: str) -> bool:
    salt, expected = stored_hash.split("$", 1)
    actual = hash_password(password, salt).split("$", 1)[1]
    return secrets.compare_digest(actual, expected)


def create_session_token(db: Session, user: User) -> str:
    token = secrets.token_urlsafe(32)
    session = AuthSession(
        token=token,
        user_id=user.id,
        expires_at=utc_now() + timedelta(days=SESSION_TTL_DAYS),
    )
    db.add(session)
    db.commit()
    return token


def create_auth_action_token(
    db: Session,
    user: User,
    purpose: str,
    ttl_hours: int,
) -> AuthActionToken:
    token = AuthActionToken(
        user_id=user.id,
        token=secrets.token_urlsafe(32),
        purpose=purpose,
        expires_at=utc_now() + timedelta(hours=ttl_hours),
    )
    db.add(token)
    db.flush()
    return token


def hash_api_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


def serialize_workspace_api_key(item: WorkspaceApiKey) -> WorkspaceApiKeyOut:
    return WorkspaceApiKeyOut(
        id=item.id,
        label=item.label,
        key_prefix=item.key_prefix,
        status=item.status,
        last_used_at=isoformat(item.last_used_at) if item.last_used_at else None,
        created_at=isoformat(item.created_at),
    )


def serialize_workspace_api_key_usage(
    item: WorkspaceApiKey,
    request_count: int,
    billable_request_count: int = 0,
    estimated_tokens: int = 0,
    estimated_cost_usd: float = 0.0,
    last_path: str | None = None,
    top_paths: list[str] | None = None,
) -> WorkspaceApiKeyUsageOut:
    return WorkspaceApiKeyUsageOut(
        id=item.id,
        label=item.label,
        key_prefix=item.key_prefix,
        status=item.status,
        request_count=request_count,
        billable_request_count=billable_request_count,
        estimated_tokens=estimated_tokens,
        estimated_cost_usd=round(estimated_cost_usd, 6),
        last_used_at=isoformat(item.last_used_at) if item.last_used_at else None,
        last_path=last_path,
        top_paths=top_paths or [],
    )


def enforce_auth_rate_limit(identifier: str) -> None:
    now = time.time()
    with auth_rate_limit_lock:
        attempts = auth_rate_limit_state.get(identifier, [])
        attempts = [item for item in attempts if now - item < AUTH_RATE_LIMIT_WINDOW_SECONDS]
        if len(attempts) >= AUTH_RATE_LIMIT_MAX_ATTEMPTS:
            raise HTTPException(
                status_code=429,
                detail="Too many authentication attempts. Please try again shortly.",
            )
        attempts.append(now)
        auth_rate_limit_state[identifier] = attempts


def clear_auth_rate_limit(identifier: str) -> None:
    with auth_rate_limit_lock:
        auth_rate_limit_state.pop(identifier, None)


def get_valid_auth_action_token(
    db: Session,
    token_value: str,
    purpose: str,
) -> AuthActionToken:
    token = db.scalar(
        select(AuthActionToken).where(
            AuthActionToken.token == token_value,
            AuthActionToken.purpose == purpose,
        )
    )
    if not token or token.status != "pending" or ensure_utc(token.expires_at) < utc_now():
        raise HTTPException(status_code=404, detail="The token is invalid or has expired.")
    return token


def get_current_user(
    request: Request,
    authorization: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
    x_workspace_id: str | None = Header(default=None, alias="X-Workspace-Id"),
    db: Session = Depends(get_db),
) -> User:
    if x_api_key:
        key_hash = hash_api_key(x_api_key.strip())
        api_key = db.scalar(select(WorkspaceApiKey).where(WorkspaceApiKey.key_hash == key_hash))
        if not api_key or api_key.status != "active":
            raise HTTPException(status_code=401, detail="The API key is invalid.")
        workspace = db.get(Workspace, api_key.workspace_id)
        if not workspace:
            raise HTTPException(status_code=404, detail="The workspace API key was not found.")
        if x_workspace_id and x_workspace_id != workspace.id:
            raise HTTPException(status_code=403, detail="The API key does not match the active workspace.")
        api_key.last_used_at = utc_now()
        db.commit()
        owner = db.get(User, workspace.owner_user_id)
        if not owner:
            raise HTTPException(status_code=404, detail="The workspace owner was not found.")
        request.state.auth_mode = "api_key"
        request.state.api_key_id = api_key.id
        request.state.auth_workspace_id = workspace.id
        request.state.auth_user_id = owner.id
        return owner

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized.")

    token = authorization.removeprefix("Bearer ").strip()
    session = db.scalar(select(AuthSession).where(AuthSession.token == token))
    if not session or ensure_utc(session.expires_at) < utc_now():
        raise HTTPException(status_code=401, detail="The session is invalid.")
    request.state.auth_mode = "session"
    request.state.api_key_id = None
    request.state.auth_workspace_id = x_workspace_id
    request.state.auth_user_id = session.user_id
    return session.user


def ensure_human_request(request: Request) -> None:
    if getattr(request.state, "auth_mode", "session") == "api_key":
        raise HTTPException(status_code=403, detail=HUMAN_ONLY_ERROR_MESSAGE)


def build_usage_metadata(request: Request, metadata: dict | None = None) -> dict:
    merged = dict(metadata or {})
    auth_mode = getattr(request.state, "auth_mode", None)
    api_key_id = getattr(request.state, "api_key_id", None)
    if auth_mode:
        merged["auth_mode"] = auth_mode
    if api_key_id:
        merged["api_key_id"] = api_key_id
    return merged


def get_conversation_or_404(
    db: Session,
    conversation_id: str,
    user_id: str,
    workspace_id: str | None = None,
) -> Conversation:
    conversation = db.scalar(
        select(Conversation).where(
            Conversation.id == conversation_id,
            Conversation.workspace_id == workspace_id,
        )
    )
    if not conversation:
        raise HTTPException(status_code=404, detail="The conversation was not found.")
    return conversation


def create_starter_conversation(
    db: Session,
    user: User,
    workspace: Workspace,
    title: str | None = None,
) -> Conversation:
    conversation = Conversation(
        user_id=user.id,
        workspace_id=workspace.id,
        title=title or "Chat baru",
        created_at=utc_now(),
        updated_at=utc_now(),
    )
    conversation.messages.append(
        Message(
            role="assistant",
            content=STARTER_MESSAGE,
            created_at=utc_now(),
        )
    )
    db.add(conversation)
    db.flush()
    db.commit()
    return db.scalar(select(Conversation).where(Conversation.id == conversation.id)) or conversation


def summarize_title(content: str) -> str:
    trimmed = content.strip()
    return (trimmed[:48] or "Chat baru").strip()


def estimate_tokens(text: str) -> int:
    return max(1, math.ceil(len(text) / 4))


def estimate_cost_usd(event_type: str, tokens_estimate: int) -> float:
    per_1k = 0.0
    if event_type == "chat_prompt":
        per_1k = CHAT_INPUT_COST_PER_1K
    elif event_type == "chat_completion":
        per_1k = CHAT_OUTPUT_COST_PER_1K
    elif event_type == "embedding_chunk":
        per_1k = EMBEDDING_COST_PER_1K
    return round((tokens_estimate / 1000) * per_1k, 8)


def chunk_text(text: str, size: int = 1400, overlap: int = 220) -> list[str]:
    cleaned = " ".join(text.split()).strip()
    if not cleaned:
        return []

    chunks: list[str] = []
    start = 0
    while start < len(cleaned):
        end = min(len(cleaned), start + size)
        chunks.append(cleaned[start:end])
        if end == len(cleaned):
            break
        start = max(end - overlap, 0)
    return chunks


def read_document_content(upload: UploadFile) -> str:
    raw = upload.file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="The file is empty.")

    filename = (upload.filename or "document").lower()

    if filename.endswith(".pdf"):
        reader = PdfReader(io.BytesIO(raw))
        text = "\n".join(page.extract_text() or "" for page in reader.pages).strip()
    else:
        try:
            text = raw.decode("utf-8").strip()
        except UnicodeDecodeError as exc:
            raise HTTPException(
                status_code=400,
                detail="Non-PDF files must be UTF-8 text.",
            ) from exc

    if not text:
        raise HTTPException(status_code=400, detail="The document content could not be read.")
    return text


def vector_norm(values: list[float]) -> float:
    return math.sqrt(sum(value * value for value in values))


def cosine_similarity(a: list[float], b: list[float], b_norm: float) -> float:
    a_norm = vector_norm(a)
    if a_norm == 0 or b_norm == 0:
        return 0.0
    dot = sum(left * right for left, right in zip(a, b))
    return dot / (a_norm * b_norm)


def keyword_overlap_score(query: str, text: str) -> float:
    query_tokens = {
        token
        for token in re.findall(r"[a-zA-Z0-9_]+", query.lower())
        if len(token) > 2
    }
    if not query_tokens:
        return 0.0

    text_tokens = set(re.findall(r"[a-zA-Z0-9_]+", text.lower()))
    overlap = query_tokens & text_tokens
    if not overlap:
        return 0.0
    return len(overlap) / len(query_tokens)


def create_embedding(text: str) -> list[float]:
    try:
        client = get_openai_client()
    except HTTPException:
        if demo_ai_enabled():
            return demo_embedding(text)
        raise
    try:
        result = client.embeddings.create(model=EMBEDDING_MODEL, input=text)
    except AuthenticationError as exc:
        if demo_ai_enabled():
            return demo_embedding(text)
        raise HTTPException(
            status_code=500,
            detail="OPENAI_API_KEY is invalid. Update backend/.env with a valid OpenAI API key.",
        ) from exc
    except APIConnectionError as exc:
        if demo_ai_enabled():
            return demo_embedding(text)
        raise HTTPException(
            status_code=502,
            detail="The backend could not reach OpenAI to process document embeddings.",
        ) from exc
    except RateLimitError as exc:
        if demo_ai_enabled():
            return demo_embedding(text)
        raise HTTPException(
            status_code=429,
            detail="Embedding requests are currently being rate limited. Please try again shortly.",
        ) from exc
    except (BadRequestError, NotFoundError) as exc:
        if demo_ai_enabled():
            return demo_embedding(text)
        raise HTTPException(
            status_code=500,
            detail=(
                "The AI embedding configuration is invalid. "
                "Check OPENAI_EMBEDDING_MODEL and make sure the model is available for this API key."
            ),
        ) from exc
    except Exception as exc:
        if demo_ai_enabled():
            return demo_embedding(text)
        raise HTTPException(
            status_code=500,
            detail=f"An error occurred while creating the document embedding: {exc}",
        ) from exc
    return result.data[0].embedding


def embedding_literal(values: list[float]) -> str:
    return "[" + ",".join(f"{value:.8f}" for value in values) + "]"


def build_context(db: Session, conversation: Conversation, prompt: str) -> str:
    workspace_documents = list_workspace_documents(db, conversation.workspace_id or "")
    documents = workspace_documents or conversation.documents
    if not documents:
        return ""

    query_embedding = create_embedding(prompt)
    if USE_NATIVE_PGVECTOR:
        try:
            with engine.connect() as connection:
                rows = connection.execute(
                    text(
                        """
                        SELECT d.name, dc.content, (dc.embedding_vector <=> CAST(:query AS vector)) AS distance
                        FROM document_chunks dc
                        JOIN documents d ON d.id = dc.document_id
                        JOIN conversations c ON c.id = d.conversation_id
                        WHERE c.workspace_id = :workspace_id
                          AND dc.embedding_vector IS NOT NULL
                        ORDER BY dc.embedding_vector <=> CAST(:query AS vector)
                        LIMIT 4
                        """
                    ),
                    {
                        "workspace_id": conversation.workspace_id,
                        "query": embedding_literal(query_embedding),
                    },
                ).fetchall()

            native_chunks = [
                (1 - float(row.distance), row.name, row.content)
                for row in rows
                if row.distance is not None and float(row.distance) < 0.85
            ]
            if native_chunks:
                return "\n\n".join(
                    f"[Document: {name} | score: {score:.2f}]\n{content}"
                    for score, name, content in native_chunks
                )
        except Exception:
            pass
    scored_chunks: list[tuple[float, str, str]] = []

    for document in documents:
        for chunk in document.chunks:
            embedding = json.loads(chunk.embedding_json)
            score = cosine_similarity(query_embedding, embedding, chunk.norm)
            scored_chunks.append((score, document.name, chunk.content))

    scored_chunks.sort(key=lambda item: item[0], reverse=True)
    top_chunks = [item for item in scored_chunks[:4] if item[0] > 0.2]

    if not top_chunks and demo_ai_enabled():
        lexical_chunks: list[tuple[float, str, str]] = []
        for document in documents:
            for chunk in document.chunks:
                score = keyword_overlap_score(prompt, chunk.content)
                lexical_chunks.append((score, document.name, chunk.content))
        lexical_chunks.sort(key=lambda item: item[0], reverse=True)
        top_chunks = [item for item in lexical_chunks[:4] if item[0] > 0]

    if not top_chunks:
        return ""

    return "\n\n".join(
        f"[Document: {name} | score: {score:.2f}]\n{content}"
        for score, name, content in top_chunks
    )


def create_usage_event(
    db: Session,
    *,
    user_id: str,
    workspace_id: str | None = None,
    event_type: str,
    conversation_id: str | None = None,
    tokens_estimate: int = 0,
    metadata: dict | None = None,
):
    db.add(
        UsageEvent(
            user_id=user_id,
            workspace_id=workspace_id,
            conversation_id=conversation_id,
            event_type=event_type,
            tokens_estimate=tokens_estimate,
            cost_estimate_usd=estimate_cost_usd(event_type, tokens_estimate),
            metadata_json=json.dumps(metadata or {}),
        )
    )


def get_admin_user(user: User = Depends(get_current_user)) -> User:
    if user.email.lower() not in ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="Admin access required.")
    return user


def get_active_workspace(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    workspace_id: str | None = Header(default=None, alias="X-Workspace-Id"),
) -> Workspace:
    if workspace_id:
        return get_workspace_or_404(db, workspace_id, user)
    return get_or_create_personal_workspace(db, user)


def get_or_create_personal_workspace(db: Session, user: User) -> Workspace:
    workspace = db.scalar(
        select(Workspace).where(
            Workspace.owner_user_id == user.id,
            Workspace.name == "Personal Workspace",
        )
    )
    if workspace:
        return workspace

    workspace = Workspace(owner_user_id=user.id, name="Personal Workspace")
    db.add(workspace)
    db.flush()
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role="owner"))
    db.commit()
    db.refresh(workspace)
    return workspace


def get_workspace_or_404(db: Session, workspace_id: str, user: User) -> Workspace:
    workspace = db.get(Workspace, workspace_id)
    if not workspace:
        raise HTTPException(status_code=404, detail="The workspace was not found.")
    is_member = any(member.user_id == user.id for member in workspace.members)
    if not is_member:
        raise HTTPException(status_code=403, detail="You do not have access to this workspace.")
    return workspace


def get_workspace_member(workspace: Workspace, user_id: str) -> WorkspaceMember | None:
    return next((member for member in workspace.members if member.user_id == user_id), None)


def ensure_workspace_role(workspace: Workspace, user: User, allowed_roles: set[str]) -> WorkspaceMember:
    member = get_workspace_member(workspace, user.id)
    if not member or member.role not in allowed_roles:
        raise HTTPException(status_code=403, detail="The workspace role is not sufficient for this action.")
    return member


def serialize_workspace(workspace: Workspace, user_id: str) -> WorkspaceOut:
    member = next((member for member in workspace.members if member.user_id == user_id), None)
    return WorkspaceOut(
        id=workspace.id,
        name=workspace.name,
        role=member.role if member else "member",
        member_count=len(workspace.members),
    )


def serialize_workspace_detail(workspace: Workspace, user_id: str) -> WorkspaceDetail:
    member = next((member for member in workspace.members if member.user_id == user_id), None)
    return WorkspaceDetail(
        id=workspace.id,
        name=workspace.name,
        role=member.role if member else "member",
        members=[
            WorkspaceMemberOut(
                email=item.user.email,
                name=item.user.name,
                role=item.role,
                department=item.department,
                cost_center=item.cost_center,
            )
            for item in workspace.members
        ],
    )


def serialize_workspace_invite(invite: WorkspaceInviteRequest, workspace_name: str) -> WorkspaceInviteOut:
    return WorkspaceInviteOut(
        id=invite.id,
        workspace_id=invite.workspace_id,
        workspace_name=workspace_name,
        email=invite.email,
        role=invite.role,
        status=invite.status,
        token=invite.token,
        accept_url=f"{APP_BASE_URL}/invite/{invite.token}",
        created_at=isoformat(invite.created_at),
    )


def serialize_public_workspace_invite(
    invite: WorkspaceInviteRequest,
    workspace_name: str,
) -> PublicWorkspaceInviteOut:
    return PublicWorkspaceInviteOut(
        workspace_name=workspace_name,
        email=invite.email,
        role=invite.role,
        status=invite.status,
        accept_url=f"{APP_BASE_URL}/invite/{invite.token}",
        created_at=isoformat(invite.created_at),
    )


def serialize_workspace_settings(
    db: Session,
    workspace: Workspace,
    subscription: WorkspaceSubscription,
) -> WorkspaceSettingsOut:
    return WorkspaceSettingsOut(
        workspace_id=workspace.id,
        workspace_name=workspace.name,
        plan_name=subscription.plan_name,
        seats_included=subscription.seats_included,
        base_price_usd=subscription.base_price_usd,
        seat_price_usd=subscription.seat_price_usd,
        monthly_token_quota=subscription.monthly_token_quota,
        monthly_document_quota=subscription.monthly_document_quota,
        smtp_enabled=bool(SMTP_HOST),
        department_budgets=list_workspace_department_budgets(db, workspace.id),
    )


def serialize_email_job(job: EmailDeliveryJob) -> EmailDeliveryJobOut:
    return EmailDeliveryJobOut(
        id=job.id,
        recipient_email=job.recipient_email,
        email_type=job.email_type,
        status=job.status,
        attempt_count=job.attempt_count,
        subject=job.subject,
        error_message=job.error_message,
        sent_at=isoformat(job.sent_at) if job.sent_at else None,
        processing_started_at=isoformat(job.processing_started_at) if job.processing_started_at else None,
        processed_at=isoformat(job.processed_at) if job.processed_at else None,
        worker_name=job.worker_name,
        created_at=isoformat(job.created_at),
    )


def create_audit_log(
    db: Session,
    *,
    workspace_id: str | None,
    actor_user_id: str | None,
    action: str,
    target_type: str,
    target_value: str,
    metadata: dict | None = None,
):
    db.add(
        AuditLog(
            workspace_id=workspace_id,
            actor_user_id=actor_user_id,
            action=action,
            target_type=target_type,
            target_value=target_value,
            metadata_json=json.dumps(metadata or {}),
        )
    )


def get_or_create_workspace_subscription(db: Session, workspace: Workspace) -> WorkspaceSubscription:
    subscription = db.scalar(
        select(WorkspaceSubscription).where(WorkspaceSubscription.workspace_id == workspace.id)
    )
    if subscription:
        return subscription

    subscription = WorkspaceSubscription(
        workspace_id=workspace.id,
        monthly_token_quota=WORKSPACE_MONTHLY_TOKEN_QUOTA,
        monthly_document_quota=WORKSPACE_MONTHLY_DOCUMENT_QUOTA,
    )
    db.add(subscription)
    db.commit()
    db.refresh(subscription)
    return subscription


def list_workspace_department_budgets(
    db: Session | None,
    workspace_id: str,
) -> list[WorkspaceDepartmentBudgetOut]:
    session = db or SessionLocal()
    owns_session = db is None
    try:
        items = session.scalars(
            select(WorkspaceDepartmentBudget)
            .where(WorkspaceDepartmentBudget.workspace_id == workspace_id)
            .order_by(WorkspaceDepartmentBudget.department.asc())
        ).all()
        return [
            WorkspaceDepartmentBudgetOut(
                id=item.id,
                department=item.department,
                monthly_budget_usd=round(item.monthly_budget_usd, 4),
                alert_threshold_ratio=round(item.alert_threshold_ratio, 4),
                created_at=isoformat(item.created_at),
                updated_at=isoformat(item.updated_at),
            )
            for item in items
        ]
    finally:
        if owns_session:
            session.close()


def build_workspace_department_alerts(
    workspace: Workspace,
    usage_by_member: dict[str, dict[str, int | float]],
    department_budgets: list[WorkspaceDepartmentBudget],
) -> list[WorkspaceDepartmentBudgetAlertOut]:
    spend_by_department: dict[str, float] = {}
    members_by_department: dict[str, int] = {}
    for member in workspace.members:
        department = (member.department or "").strip()
        if not department:
            continue
        members_by_department[department] = members_by_department.get(department, 0) + 1
        spend_by_department[department] = spend_by_department.get(department, 0.0) + float(
            usage_by_member.get(member.user_id, {}).get("estimated_usage_cost_usd", 0.0)
        )

    alerts: list[WorkspaceDepartmentBudgetAlertOut] = []
    for budget in department_budgets:
        spend_usd = round(spend_by_department.get(budget.department, 0.0), 6)
        utilization_ratio = spend_usd / budget.monthly_budget_usd if budget.monthly_budget_usd > 0 else 0.0
        if utilization_ratio >= 1:
            status = "exceeded"
        elif utilization_ratio >= budget.alert_threshold_ratio:
            status = "warning"
        else:
            status = "healthy"
        alerts.append(
            WorkspaceDepartmentBudgetAlertOut(
                department=budget.department,
                monthly_budget_usd=round(budget.monthly_budget_usd, 4),
                spend_usd=spend_usd,
                utilization_ratio=round(utilization_ratio, 4),
                member_count=members_by_department.get(budget.department, 0),
                status=status,
                alert_threshold_ratio=round(budget.alert_threshold_ratio, 4),
            )
        )
    return sorted(
        alerts,
        key=lambda item: ({"exceeded": 0, "warning": 1, "healthy": 2}.get(item.status, 3), -item.utilization_ratio),
    )


def list_workspace_documents(db: Session, workspace_id: str) -> list[Document]:
    return db.scalars(
        select(Document)
        .join(Conversation, Conversation.id == Document.conversation_id)
        .where(Conversation.workspace_id == workspace_id)
        .order_by(Document.created_at.desc())
    ).all()


def usage_window_start() -> datetime:
    now = utc_now()
    return datetime(now.year, now.month, 1, tzinfo=timezone.utc)


def month_window(offset: int = 0) -> tuple[datetime, datetime]:
    now = utc_now()
    month_index = (now.year * 12 + (now.month - 1)) + offset
    year = month_index // 12
    month = month_index % 12 + 1
    start = datetime(year, month, 1, tzinfo=timezone.utc)
    next_month_index = month_index + 1
    next_year = next_month_index // 12
    next_month = next_month_index % 12 + 1
    end = datetime(next_year, next_month, 1, tzinfo=timezone.utc)
    return start, end


def get_workspace_usage_totals(db: Session, workspace_id: str) -> tuple[int, int]:
    current_month_start = usage_window_start()
    workspace_usage_events = db.scalars(
        select(UsageEvent).where(
            UsageEvent.workspace_id == workspace_id,
            UsageEvent.created_at >= current_month_start,
        )
    ).all()
    tokens_used = sum(event.tokens_estimate for event in workspace_usage_events)
    documents_used = sum(
        1 for event in workspace_usage_events if event.event_type == "document_upload"
    )
    return tokens_used, documents_used


def build_workspace_billing_summary(db: Session, workspace: Workspace) -> WorkspaceBillingSummary:
    member_ids = [member.user_id for member in workspace.members]
    usage_events = db.scalars(
        select(UsageEvent).where(UsageEvent.user_id.in_(member_ids))
    ).all()
    return WorkspaceBillingSummary(
        workspace_id=workspace.id,
        workspace_name=workspace.name,
        member_count=len(workspace.members),
        estimated_total_tokens=sum(
            event.tokens_estimate for event in usage_events if event.workspace_id == workspace.id
        ),
        estimated_total_cost_usd=round(
            sum(event.cost_estimate_usd for event in usage_events if event.workspace_id == workspace.id),
            6,
        ),
        chats_sent=sum(
            1
            for event in usage_events
            if event.workspace_id == workspace.id and event.event_type == "chat_prompt"
        ),
        documents_uploaded=sum(
            1
            for event in usage_events
            if event.workspace_id == workspace.id and event.event_type == "document_upload"
        ),
    )


def build_workspace_subscription_summary(db: Session, workspace: Workspace) -> WorkspaceSubscriptionSummary:
    billing = build_workspace_billing_summary(db, workspace)
    subscription = get_or_create_workspace_subscription(db, workspace)
    seats = len(workspace.members)
    platform_fee = subscription.base_price_usd
    seat_fee = seats * subscription.seat_price_usd
    usage_fee = billing.estimated_total_cost_usd * 1.3
    estimated_monthly_cost = round(platform_fee + seat_fee + usage_fee, 2)
    current_month_start = usage_window_start()
    workspace_usage_events = db.scalars(
        select(UsageEvent).where(
            UsageEvent.workspace_id == workspace.id,
            UsageEvent.created_at >= current_month_start,
        )
    ).all()
    quota_tokens_used = sum(event.tokens_estimate for event in workspace_usage_events)
    quota_documents_used = sum(
        1 for event in workspace_usage_events if event.event_type == "document_upload"
    )
    return WorkspaceSubscriptionSummary(
        workspace_id=workspace.id,
        provider=subscription.provider,
        plan_name=subscription.plan_name,
        status=subscription.status,
        current_period_end=isoformat(subscription.current_period_end),
        seats_in_use=seats,
        seats_included=subscription.seats_included,
        stripe_customer_id=subscription.stripe_customer_id,
        stripe_subscription_id=subscription.stripe_subscription_id,
        cancel_at_period_end=subscription.cancel_at_period_end,
        monthly_token_quota=subscription.monthly_token_quota,
        monthly_document_quota=subscription.monthly_document_quota,
        quota_tokens_used=quota_tokens_used,
        quota_documents_used=quota_documents_used,
        estimated_monthly_cost_usd=estimated_monthly_cost,
    )


def get_workspace_request_logs(
    db: Session,
    workspace_id: str,
    *,
    limit: int = 50,
    offset: int = 0,
    status_code: int | None = None,
    auth_mode: str | None = None,
    path_query: str | None = None,
) -> tuple[list[RequestLog], int]:
    query = (
        select(RequestLog)
        .where(RequestLog.workspace_id == workspace_id)
        .order_by(RequestLog.created_at.desc())
    )
    if status_code is not None:
        query = query.where(RequestLog.status_code == status_code)
    if auth_mode:
        query = query.where(RequestLog.auth_mode == auth_mode)
    if path_query:
        query = query.where(RequestLog.path.ilike(f"%{path_query}%"))
    all_logs = db.scalars(query).all()
    return all_logs[offset : offset + limit], len(all_logs)


def serialize_request_log_entries(db: Session, logs: list[RequestLog]) -> list[RequestLogEntryOut]:
    user_ids = {log.user_id for log in logs if log.user_id}
    api_key_ids = {log.api_key_id for log in logs if log.api_key_id}
    user_map = {
        item.id: item
        for item in db.scalars(select(User).where(User.id.in_(user_ids))).all()
    } if user_ids else {}
    api_key_map = {
        item.id: item
        for item in db.scalars(select(WorkspaceApiKey).where(WorkspaceApiKey.id.in_(api_key_ids))).all()
    } if api_key_ids else {}
    return [
        RequestLogEntryOut(
            id=log.id,
            method=log.method,
            path=log.path,
            status_code=log.status_code,
            duration_ms=log.duration_ms,
            auth_mode=log.auth_mode,
            user_email=user_map[log.user_id].email if log.user_id in user_map else None,
            api_key_label=api_key_map[log.api_key_id].label if log.api_key_id in api_key_map else None,
            created_at=isoformat(log.created_at),
        )
        for log in logs
    ]


def build_workspace_invoice_summary(
    db: Session,
    workspace: Workspace,
    *,
    period_start: datetime | None = None,
    period_end: datetime | None = None,
    period_label: str | None = None,
) -> WorkspaceInvoiceSummaryOut:
    subscription = get_or_create_workspace_subscription(db, workspace)
    department_budgets = db.scalars(
        select(WorkspaceDepartmentBudget).where(WorkspaceDepartmentBudget.workspace_id == workspace.id)
    ).all()
    resolved_period_start = period_start or usage_window_start()
    resolved_period_end = period_end or subscription.current_period_end
    member_ids = [member.user_id for member in workspace.members]
    usage_events = db.scalars(
        select(UsageEvent).where(
            UsageEvent.user_id.in_(member_ids),
            UsageEvent.workspace_id == workspace.id,
            UsageEvent.created_at >= resolved_period_start,
            UsageEvent.created_at < resolved_period_end,
        )
    ).all()
    request_logs = db.scalars(
        select(RequestLog).where(
            RequestLog.workspace_id == workspace.id,
            RequestLog.created_at >= resolved_period_start,
            RequestLog.created_at < resolved_period_end,
        )
    ).all()
    estimated_total_tokens = sum(event.tokens_estimate for event in usage_events)
    estimated_total_cost_usd = round(sum(event.cost_estimate_usd for event in usage_events), 6)
    documents_uploaded = sum(1 for event in usage_events if event.event_type == "document_upload")
    api_key_request_count = sum(1 for log in request_logs if log.api_key_id)
    usage_by_member: dict[str, dict[str, int | float]] = {
        member.user_id: {
            "token_usage": 0,
            "estimated_usage_cost_usd": 0.0,
            "chats_sent": 0,
            "documents_uploaded": 0,
        }
        for member in workspace.members
    }
    for event in usage_events:
        bucket = usage_by_member.get(event.user_id)
        if not bucket:
            continue
        bucket["token_usage"] += event.tokens_estimate
        bucket["estimated_usage_cost_usd"] += event.cost_estimate_usd
        if event.event_type == "chat_prompt":
            bucket["chats_sent"] += 1
        if event.event_type == "document_upload":
            bucket["documents_uploaded"] += 1
    base_fee = subscription.base_price_usd
    seat_overage = max(len(workspace.members) - subscription.seats_included, 0)
    seat_fee = seat_overage * subscription.seat_price_usd
    usage_fee = round(estimated_total_cost_usd * 1.3, 4)
    total_usd = round(base_fee + seat_fee + usage_fee, 4)
    line_items = [
        WorkspaceInvoiceLineItemOut(
            label=f"Base plan - {subscription.plan_name}",
            amount_usd=round(base_fee, 4),
            quantity=1,
            unit="plan",
        ),
        WorkspaceInvoiceLineItemOut(
            label="Seat overage",
            amount_usd=round(seat_fee, 4),
            quantity=seat_overage,
            unit="seat",
        ),
        WorkspaceInvoiceLineItemOut(
            label="Usage markup",
            amount_usd=usage_fee,
            quantity=estimated_total_tokens,
            unit="token-est",
        ),
    ]
    return WorkspaceInvoiceSummaryOut(
        workspace_id=workspace.id,
        workspace_name=workspace.name,
        period_label=period_label or resolved_period_start.strftime("%B %Y"),
        period_start=isoformat(resolved_period_start),
        period_end=isoformat(resolved_period_end),
        currency="USD",
        seats_in_use=len(workspace.members),
        seats_included=subscription.seats_included,
        token_usage=estimated_total_tokens,
        document_uploads=documents_uploaded,
        request_count=len(request_logs),
        api_key_request_count=api_key_request_count,
        estimated_usage_cost_usd=estimated_total_cost_usd,
        subtotal_usd=round(base_fee + seat_fee, 4),
        total_usd=total_usd,
        line_items=line_items,
        member_breakdown=[
            WorkspaceInvoiceMemberOut(
                email=member.user.email,
                name=member.user.name,
                role=member.role,
                department=member.department,
                cost_center=member.cost_center,
                token_usage=int(usage_by_member[member.user_id]["token_usage"]),
                estimated_usage_cost_usd=round(
                    float(usage_by_member[member.user_id]["estimated_usage_cost_usd"]), 6
                ),
                chats_sent=int(usage_by_member[member.user_id]["chats_sent"]),
                documents_uploaded=int(usage_by_member[member.user_id]["documents_uploaded"]),
            )
            for member in workspace.members
        ],
        department_alerts=build_workspace_department_alerts(
            workspace,
            usage_by_member,
            department_budgets,
        ),
    )


def enforce_workspace_token_quota(
    db: Session,
    workspace_id: str | None,
    incoming_tokens: int = 0,
) -> None:
    if not workspace_id:
        return
    subscription = db.scalar(
        select(WorkspaceSubscription).where(WorkspaceSubscription.workspace_id == workspace_id)
    )
    token_quota = subscription.monthly_token_quota if subscription else WORKSPACE_MONTHLY_TOKEN_QUOTA
    tokens_used, _ = get_workspace_usage_totals(db, workspace_id)
    if tokens_used + incoming_tokens > token_quota:
        raise HTTPException(
            status_code=402,
            detail=(
                "The workspace token quota for this month has been exhausted. "
                "Upgrade the plan or wait for the monthly quota reset."
            ),
        )


def enforce_workspace_document_quota(db: Session, workspace_id: str | None) -> None:
    if not workspace_id:
        return
    subscription = db.scalar(
        select(WorkspaceSubscription).where(WorkspaceSubscription.workspace_id == workspace_id)
    )
    document_quota = (
        subscription.monthly_document_quota if subscription else WORKSPACE_MONTHLY_DOCUMENT_QUOTA
    )
    _, documents_used = get_workspace_usage_totals(db, workspace_id)
    if documents_used >= document_quota:
        raise HTTPException(
            status_code=402,
            detail=(
                "The workspace document quota for this month has been exhausted. "
                "Remove older documents or upgrade the plan."
            ),
        )


def send_workspace_invite_email(invite: WorkspaceInviteRequest, workspace_name: str) -> bool:
    if not SMTP_HOST:
        return False

    message = EmailMessage()
    message["Subject"] = f"Invitation to workspace {workspace_name}"
    message["From"] = f"{SMTP_FROM_NAME} <{SMTP_FROM_EMAIL}>"
    message["To"] = invite.email
    message.set_content(
        "\n".join(
            [
                f"You have been invited to join the project {workspace_name}.",
                "",
                f"Open this link to accept the invitation: {APP_BASE_URL}/invite/{invite.token}",
            ]
        )
    )

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as server:
        if SMTP_USE_TLS:
            server.starttls()
        if SMTP_USERNAME:
            server.login(SMTP_USERNAME, SMTP_PASSWORD)
        server.send_message(message)
    return True


def create_invite_email_job(
    db: Session,
    invite: WorkspaceInviteRequest,
    workspace_name: str,
) -> EmailDeliveryJob:
    subject = f"Invitation to workspace {workspace_name}"
    body_text = "\n".join(
        [
            f"You have been invited to join the project {workspace_name}.",
            "",
            f"Open this link to accept the invitation: {APP_BASE_URL}/invite/{invite.token}",
        ]
    )
    job = EmailDeliveryJob(
        workspace_id=invite.workspace_id,
        related_invite_id=invite.id,
        recipient_email=invite.email,
        subject=subject,
        body_text=body_text,
    )
    db.add(job)
    db.flush()
    return job


def deliver_email_job(job: EmailDeliveryJob) -> None:
    if not SMTP_HOST:
        return

    message = EmailMessage()
    message["Subject"] = job.subject
    message["From"] = f"{SMTP_FROM_NAME} <{SMTP_FROM_EMAIL}>"
    message["To"] = job.recipient_email
    message.set_content(job.body_text)

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as server:
        if SMTP_USE_TLS:
            server.starttls()
        if SMTP_USERNAME:
            server.login(SMTP_USERNAME, SMTP_PASSWORD)
        server.send_message(message)


def queue_auth_email_job(
    db: Session,
    user: User,
    purpose: str,
    token_value: str,
) -> EmailDeliveryJob:
    if purpose == "verify_email":
        subject = "Verify your Project Review Workspace account"
        link = f"{APP_BASE_URL}/verify-email/{token_value}"
        body = "\n".join(
            [
                f"Hello {user.name},",
                "",
                "Use the link below to verify your account email:",
                link,
            ]
        )
    else:
        subject = "Reset your Project Review Workspace password"
        link = f"{APP_BASE_URL}/reset-password/{token_value}"
        body = "\n".join(
            [
                f"Hello {user.name},",
                "",
                "Use the link below to reset your password:",
                link,
            ]
        )

    job = EmailDeliveryJob(
        recipient_email=user.email,
        email_type=purpose,
        subject=subject,
        body_text=body,
        status="pending",
    )
    db.add(job)
    db.flush()
    return job


def process_pending_email_jobs(limit: int = 20, worker_name: str = "inline-worker") -> dict[str, int]:
    processed = 0
    sent = 0
    failed = 0
    db = SessionLocal()
    try:
        lease_cutoff = utc_now() - timedelta(seconds=max(EMAIL_JOB_LEASE_SECONDS, 30))
        jobs = db.scalars(
            select(EmailDeliveryJob)
            .where(EmailDeliveryJob.status.in_(["pending", "failed", "processing"]))
            .order_by(EmailDeliveryJob.created_at.asc())
        ).all()[:limit]
        for job in jobs:
            if job.status == "processing" and job.processing_started_at and job.processing_started_at > lease_cutoff:
                continue
            if job.status == "failed" and job.attempt_count >= 5:
                continue
            job.status = "processing"
            job.processing_started_at = utc_now()
            job.worker_name = worker_name
            job.updated_at = utc_now()
            db.commit()
            processed += 1
            try:
                deliver_email_job(job)
                job.status = "sent"
                job.sent_at = utc_now()
                job.processed_at = utc_now()
                job.error_message = None
                sent += 1
            except Exception as exc:
                job.status = "failed"
                job.error_message = str(exc)
                job.processed_at = utc_now()
                failed += 1
            job.attempt_count += 1
            job.updated_at = utc_now()
        db.commit()
    finally:
        db.close()
    return {"processed": processed, "sent": sent, "failed": failed}


def log_request_event(
    request: Request,
    response_status: int,
    duration_ms: int,
) -> None:
    if request.url.path in {"/health"}:
        return

    db = SessionLocal()
    try:
        workspace_id = request.headers.get("X-Workspace-Id")
        user_id: str | None = None
        api_key_id: str | None = None

        authorization = request.headers.get("Authorization")
        if authorization and authorization.startswith("Bearer "):
            token_value = authorization.removeprefix("Bearer ").strip()
            session = db.scalar(select(AuthSession).where(AuthSession.token == token_value))
            if session and session.expires_at >= utc_now():
                user_id = session.user_id

        api_key_header = request.headers.get("X-API-Key")
        if api_key_header:
            api_key = db.scalar(
                select(WorkspaceApiKey).where(WorkspaceApiKey.key_hash == hash_api_key(api_key_header))
            )
            if api_key:
                api_key_id = api_key.id
                workspace_id = workspace_id or api_key.workspace_id

        db.add(
            RequestLog(
                workspace_id=workspace_id,
                user_id=user_id,
                api_key_id=api_key_id,
                method=request.method,
                path=request.url.path[:255],
                status_code=response_status,
                duration_ms=duration_ms,
                auth_mode=getattr(request.state, "auth_mode", None),
            )
        )
        db.commit()
    finally:
        db.close()


def start_email_job_worker() -> None:
    global email_job_worker_started
    if email_job_worker_started or not AUTO_PROCESS_EMAIL_JOBS:
        return

    email_job_worker_started = True

    def worker() -> None:
        while True:
            try:
                process_pending_email_jobs(worker_name="app-thread-worker")
            except Exception:
                pass
            time.sleep(max(EMAIL_JOB_POLL_SECONDS, 5))

    thread = threading.Thread(target=worker, daemon=True, name="email-job-worker")
    thread.start()


@app.middleware("http")
async def request_logging_middleware(request: Request, call_next):
    started_at = time.time()
    response = await call_next(request)
    duration_ms = int((time.time() - started_at) * 1000)
    try:
        log_request_event(request, response.status_code, duration_ms)
    except Exception:
        pass
    return response


@app.get("/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/auth/providers", response_model=AuthProvidersResponse)
async def get_auth_providers() -> AuthProvidersResponse:
    return AuthProvidersResponse(
        email_password=AuthProviderStatus(
            enabled=True,
            label="Email and password",
            description="Sign in or create an account using your work email and the password you choose.",
        ),
        google=get_google_provider_status(),
    )


@app.post("/auth/register", response_model=AuthResponse)
async def register(payload: AuthPayload, db: Session = Depends(get_db)):
    enforce_auth_rate_limit(f"register:{payload.email.lower()}")
    if not payload.name or len(payload.name.strip()) < 2:
        raise HTTPException(status_code=400, detail="The name must be at least 2 characters.")
    if len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="The password must be at least 8 characters.")

    existing_user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if existing_user:
        raise HTTPException(status_code=409, detail="The email is already registered.")

    user = User(
        name=payload.name.strip(),
        email=payload.email.lower(),
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    db.flush()

    verification_token = create_auth_action_token(
        db,
        user,
        "verify_email",
        EMAIL_VERIFICATION_TTL_HOURS,
    )
    queue_auth_email_job(db, user, "verify_email", verification_token.token)
    db.commit()
    db.refresh(user)

    workspace = get_or_create_personal_workspace(db, user)
    create_starter_conversation(db, user, workspace)
    token = create_session_token(db, user)
    clear_auth_rate_limit(f"register:{payload.email.lower()}")
    return AuthResponse(token=token, user=serialize_user(user))


@app.post("/auth/login", response_model=AuthResponse)
async def login(payload: AuthPayload, db: Session = Depends(get_db)):
    enforce_auth_rate_limit(f"login:{payload.email.lower()}")
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="The email or password is incorrect.")

    token = create_session_token(db, user)
    clear_auth_rate_limit(f"login:{payload.email.lower()}")
    return AuthResponse(token=token, user=serialize_user(user))


@app.post("/auth/google", response_model=AuthResponse)
async def google_login(payload: GoogleAuthPayload, db: Session = Depends(get_db)):
    token_data = verify_google_credential(payload.credential)
    email = token_data["email"].strip().lower()
    name = (token_data.get("name") or email.split("@")[0]).strip() or "Google User"

    user = db.scalar(select(User).where(User.email == email))
    is_new_user = user is None
    if not user:
        user = User(
            name=name,
            email=email,
            password_hash=hash_password(secrets.token_urlsafe(32)),
            email_verified=True,
        )
        db.add(user)
        db.flush()
    else:
        if not user.email_verified:
            user.email_verified = True
        if not user.name.strip():
            user.name = name

    db.commit()
    db.refresh(user)

    workspace = get_or_create_personal_workspace(db, user)
    if is_new_user:
        create_starter_conversation(db, user, workspace)

    token = create_session_token(db, user)
    return AuthResponse(token=token, user=serialize_user(user))


@app.post("/auth/password-reset/request")
async def request_password_reset(payload: PasswordResetRequest, db: Session = Depends(get_db)):
    enforce_auth_rate_limit(f"password-reset:{payload.email.lower()}")
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if user:
        token = create_auth_action_token(db, user, "reset_password", PASSWORD_RESET_TTL_HOURS)
        queue_auth_email_job(db, user, "reset_password", token.token)
        db.commit()
    return {"ok": True}


@app.get("/auth/action-tokens/{token_value}", response_model=AuthActionTokenOut)
async def get_auth_action_token(token_value: str, db: Session = Depends(get_db)):
    token = db.scalar(select(AuthActionToken).where(AuthActionToken.token == token_value))
    if not token:
        raise HTTPException(status_code=404, detail="The token was not found.")
    user = db.get(User, token.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="The user was not found.")
    return AuthActionTokenOut(
        email=user.email,
        purpose=token.purpose,
        status=token.status,
        expires_at=isoformat(token.expires_at),
    )


@app.post("/auth/verify-email/{token_value}")
async def verify_email(token_value: str, db: Session = Depends(get_db)):
    token = get_valid_auth_action_token(db, token_value, "verify_email")
    user = db.get(User, token.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="The user was not found.")
    user.email_verified = True
    token.status = "used"
    token.used_at = utc_now()
    db.commit()
    return {"ok": True, "email": user.email}


@app.post("/auth/password-reset/{token_value}")
async def confirm_password_reset(
    token_value: str,
    payload: PasswordResetConfirm,
    db: Session = Depends(get_db),
):
    if len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="The password must be at least 8 characters.")
    token = get_valid_auth_action_token(db, token_value, "reset_password")
    user = db.get(User, token.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="The user was not found.")
    user.password_hash = hash_password(payload.password)
    token.status = "used"
    token.used_at = utc_now()
    db.commit()
    return {"ok": True, "email": user.email}


@app.post("/system/process-email-jobs")
async def process_email_jobs_endpoint(
    request: Request,
    admin_user: User = Depends(get_admin_user),
):
    del admin_user
    ensure_human_request(request)
    return process_pending_email_jobs(worker_name="manual-admin-trigger")


@app.get("/system/email-worker-status", response_model=EmailWorkerStatusOut)
async def email_worker_status(
    request: Request,
    admin_user: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    del admin_user
    ensure_human_request(request)
    jobs = db.scalars(select(EmailDeliveryJob)).all()
    processed_jobs = [job for job in jobs if job.processed_at]
    latest_processed = max((job.processed_at for job in processed_jobs if job.processed_at), default=None)
    return EmailWorkerStatusOut(
        worker_enabled=AUTO_PROCESS_EMAIL_JOBS,
        worker_running=email_job_worker_started,
        queue_depth=sum(1 for job in jobs if job.status == "pending"),
        processing_jobs=sum(1 for job in jobs if job.status == "processing"),
        failed_jobs=sum(1 for job in jobs if job.status == "failed"),
        last_processed_at=isoformat(latest_processed) if latest_processed else None,
    )


@app.get("/auth/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)):
    return serialize_user(user)


@app.get("/workspaces", response_model=list[WorkspaceOut])
async def list_workspaces(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    get_or_create_personal_workspace(db, user)
    memberships = db.scalars(
        select(WorkspaceMember).where(WorkspaceMember.user_id == user.id)
    ).all()
    workspaces = [db.get(Workspace, membership.workspace_id) for membership in memberships]
    return [serialize_workspace(workspace, user.id) for workspace in workspaces if workspace]


@app.post("/workspaces", response_model=WorkspaceDetail)
async def create_workspace(
    payload: WorkspaceCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    name = payload.name.strip()
    if len(name) < 3:
        raise HTTPException(status_code=400, detail="The workspace name must be at least 3 characters.")

    workspace = Workspace(owner_user_id=user.id, name=name)
    db.add(workspace)
    db.flush()
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role="owner"))
    db.commit()
    db.refresh(workspace)
    return serialize_workspace_detail(workspace, user.id)


@app.get("/workspaces/{workspace_id}", response_model=WorkspaceDetail)
async def get_workspace(
    workspace_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    workspace = get_workspace_or_404(db, workspace_id, user)
    return serialize_workspace_detail(workspace, user.id)


@app.get("/workspaces/{workspace_id}/usage-by-member", response_model=list[WorkspaceMemberUsageOut])
async def workspace_usage_by_member(
    workspace_id: str,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ensure_human_request(request)
    workspace = get_workspace_or_404(db, workspace_id, user)
    ensure_workspace_role(workspace, user, {"owner", "admin"})

    usage_events = db.scalars(
        select(UsageEvent).where(UsageEvent.workspace_id == workspace.id)
    ).all()
    usage_by_user: dict[str, dict[str, float | int]] = {
        member.user_id: {
            "estimated_total_tokens": 0,
            "estimated_total_cost_usd": 0.0,
            "chats_sent": 0,
            "documents_uploaded": 0,
        }
        for member in workspace.members
    }

    for event in usage_events:
        bucket = usage_by_user.get(event.user_id)
        if not bucket:
            continue
        bucket["estimated_total_tokens"] += event.tokens_estimate
        bucket["estimated_total_cost_usd"] += event.cost_estimate_usd
        if event.event_type == "chat_prompt":
            bucket["chats_sent"] += 1
        if event.event_type == "document_upload":
            bucket["documents_uploaded"] += 1

    return [
        WorkspaceMemberUsageOut(
            email=member.user.email,
            name=member.user.name,
            role=member.role,
            department=member.department,
            cost_center=member.cost_center,
            estimated_total_tokens=int(usage_by_user[member.user_id]["estimated_total_tokens"]),
            estimated_total_cost_usd=round(
                float(usage_by_user[member.user_id]["estimated_total_cost_usd"]), 6
            ),
            chats_sent=int(usage_by_user[member.user_id]["chats_sent"]),
            documents_uploaded=int(usage_by_user[member.user_id]["documents_uploaded"]),
        )
        for member in workspace.members
    ]


@app.get("/workspaces/{workspace_id}/settings", response_model=WorkspaceSettingsOut)
async def get_workspace_settings(
    workspace_id: str,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ensure_human_request(request)
    workspace = get_workspace_or_404(db, workspace_id, user)
    ensure_workspace_role(workspace, user, {"owner", "admin"})
    subscription = get_or_create_workspace_subscription(db, workspace)
    return serialize_workspace_settings(db, workspace, subscription)


@app.post("/workspaces/{workspace_id}/settings", response_model=WorkspaceSettingsOut)
async def update_workspace_settings(
    workspace_id: str,
    payload: WorkspaceSettingsUpdate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ensure_human_request(request)
    workspace = get_workspace_or_404(db, workspace_id, user)
    ensure_workspace_role(workspace, user, {"owner"})
    subscription = get_or_create_workspace_subscription(db, workspace)

    if payload.plan_name is not None:
        subscription.plan_name = payload.plan_name.strip() or subscription.plan_name
    if payload.seats_included is not None:
        subscription.seats_included = max(payload.seats_included, 1)
    if payload.base_price_usd is not None:
        subscription.base_price_usd = max(payload.base_price_usd, 0.0)
    if payload.seat_price_usd is not None:
        subscription.seat_price_usd = max(payload.seat_price_usd, 0.0)
    if payload.monthly_token_quota is not None:
        subscription.monthly_token_quota = max(payload.monthly_token_quota, 1000)
    if payload.monthly_document_quota is not None:
        subscription.monthly_document_quota = max(payload.monthly_document_quota, 1)
    subscription.updated_at = utc_now()
    create_audit_log(
        db,
        workspace_id=workspace.id,
        actor_user_id=user.id,
        action="workspace.settings_updated",
        target_type="workspace",
        target_value=workspace.id,
        metadata={
            "plan_name": subscription.plan_name,
            "seats_included": subscription.seats_included,
            "monthly_token_quota": subscription.monthly_token_quota,
            "monthly_document_quota": subscription.monthly_document_quota,
        },
    )
    db.commit()
    return serialize_workspace_settings(db, workspace, subscription)


@app.get("/workspaces/{workspace_id}/department-budgets", response_model=list[WorkspaceDepartmentBudgetOut])
async def get_workspace_department_budgets(
    workspace_id: str,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ensure_human_request(request)
    workspace = get_workspace_or_404(db, workspace_id, user)
    ensure_workspace_role(workspace, user, {"owner", "admin"})
    return list_workspace_department_budgets(db, workspace.id)


@app.post("/workspaces/{workspace_id}/department-budgets", response_model=list[WorkspaceDepartmentBudgetOut])
async def upsert_workspace_department_budget(
    workspace_id: str,
    payload: WorkspaceDepartmentBudgetUpsert,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ensure_human_request(request)
    workspace = get_workspace_or_404(db, workspace_id, user)
    ensure_workspace_role(workspace, user, {"owner", "admin"})

    department = payload.department.strip()
    if len(department) < 2:
        raise HTTPException(status_code=400, detail="The department name must be at least 2 characters.")
    monthly_budget_usd = round(max(payload.monthly_budget_usd, 0.0), 4)
    alert_threshold_ratio = min(max(payload.alert_threshold_ratio, 0.1), 1.0)

    item = db.scalar(
        select(WorkspaceDepartmentBudget).where(
            WorkspaceDepartmentBudget.workspace_id == workspace.id,
            WorkspaceDepartmentBudget.department == department,
        )
    )
    if item:
        item.monthly_budget_usd = monthly_budget_usd
        item.alert_threshold_ratio = alert_threshold_ratio
        item.updated_at = utc_now()
        audit_action = "workspace.department_budget_updated"
    else:
        item = WorkspaceDepartmentBudget(
            workspace_id=workspace.id,
            department=department,
            monthly_budget_usd=monthly_budget_usd,
            alert_threshold_ratio=alert_threshold_ratio,
        )
        db.add(item)
        audit_action = "workspace.department_budget_created"

    create_audit_log(
        db,
        workspace_id=workspace.id,
        actor_user_id=user.id,
        action=audit_action,
        target_type="department_budget",
        target_value=department,
        metadata={
            "monthly_budget_usd": monthly_budget_usd,
            "alert_threshold_ratio": alert_threshold_ratio,
        },
    )
    db.commit()
    return list_workspace_department_budgets(db, workspace.id)


@app.delete(
    "/workspaces/{workspace_id}/department-budgets/{budget_id}",
    response_model=list[WorkspaceDepartmentBudgetOut],
)
async def delete_workspace_department_budget(
    workspace_id: str,
    budget_id: str,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ensure_human_request(request)
    workspace = get_workspace_or_404(db, workspace_id, user)
    ensure_workspace_role(workspace, user, {"owner", "admin"})
    item = db.get(WorkspaceDepartmentBudget, budget_id)
    if not item or item.workspace_id != workspace.id:
        raise HTTPException(status_code=404, detail="The department budget was not found.")
    department = item.department
    db.delete(item)
    create_audit_log(
        db,
        workspace_id=workspace.id,
        actor_user_id=user.id,
        action="workspace.department_budget_deleted",
        target_type="department_budget",
        target_value=department,
        metadata={},
    )
    db.commit()
    return list_workspace_department_budgets(db, workspace.id)


@app.get("/workspaces/{workspace_id}/email-jobs", response_model=list[EmailDeliveryJobOut])
async def list_workspace_email_jobs(
    workspace_id: str,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ensure_human_request(request)
    workspace = get_workspace_or_404(db, workspace_id, user)
    ensure_workspace_role(workspace, user, {"owner", "admin"})
    jobs = db.scalars(
        select(EmailDeliveryJob)
        .where(EmailDeliveryJob.workspace_id == workspace.id)
        .order_by(EmailDeliveryJob.created_at.desc())
    ).all()
    return [serialize_email_job(job) for job in jobs[:50]]


@app.get("/workspaces/{workspace_id}/api-keys", response_model=list[WorkspaceApiKeyOut])
async def list_workspace_api_keys(
    workspace_id: str,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ensure_human_request(request)
    workspace = get_workspace_or_404(db, workspace_id, user)
    ensure_workspace_role(workspace, user, {"owner", "admin"})
    keys = db.scalars(
        select(WorkspaceApiKey)
        .where(WorkspaceApiKey.workspace_id == workspace.id)
        .order_by(WorkspaceApiKey.created_at.desc())
    ).all()
    return [serialize_workspace_api_key(item) for item in keys]


@app.get("/workspaces/{workspace_id}/api-keys/usage", response_model=list[WorkspaceApiKeyUsageOut])
async def workspace_api_key_usage(
    workspace_id: str,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ensure_human_request(request)
    workspace = get_workspace_or_404(db, workspace_id, user)
    ensure_workspace_role(workspace, user, {"owner", "admin"})

    keys = db.scalars(
        select(WorkspaceApiKey).where(WorkspaceApiKey.workspace_id == workspace.id)
    ).all()
    request_logs = db.scalars(
        select(RequestLog).where(RequestLog.workspace_id == workspace.id)
    ).all()
    request_counts: dict[str, int] = {}
    last_path_by_key: dict[str, str] = {}
    path_counts_by_key: dict[str, dict[str, int]] = {}
    for log in request_logs:
        if log.api_key_id:
            request_counts[log.api_key_id] = request_counts.get(log.api_key_id, 0) + 1
            last_path_by_key.setdefault(log.api_key_id, log.path)
            path_counts = path_counts_by_key.setdefault(log.api_key_id, {})
            path_counts[log.path] = path_counts.get(log.path, 0) + 1

    usage_events = db.scalars(
        select(UsageEvent).where(UsageEvent.workspace_id == workspace.id)
    ).all()
    usage_by_key: dict[str, dict[str, float | int]] = {}
    for event in usage_events:
        metadata = json.loads(event.metadata_json or "{}")
        api_key_id = metadata.get("api_key_id")
        if not api_key_id:
            continue
        bucket = usage_by_key.setdefault(
            api_key_id,
            {"estimated_tokens": 0, "estimated_cost_usd": 0.0, "billable_request_count": 0},
        )
        bucket["estimated_tokens"] += event.tokens_estimate
        bucket["estimated_cost_usd"] += event.cost_estimate_usd
        if event.event_type in {"chat_prompt", "document_upload"}:
            bucket["billable_request_count"] += 1

    return [
        serialize_workspace_api_key_usage(
            item,
            request_counts.get(item.id, 0),
            billable_request_count=int(usage_by_key.get(item.id, {}).get("billable_request_count", 0)),
            estimated_tokens=int(usage_by_key.get(item.id, {}).get("estimated_tokens", 0)),
            estimated_cost_usd=float(usage_by_key.get(item.id, {}).get("estimated_cost_usd", 0.0)),
            last_path=last_path_by_key.get(item.id),
            top_paths=[
                path
                for path, _ in sorted(
                    path_counts_by_key.get(item.id, {}).items(),
                    key=lambda pair: pair[1],
                    reverse=True,
                )[:3]
            ],
        )
        for item in keys
    ]


@app.post("/workspaces/{workspace_id}/api-keys", response_model=WorkspaceApiKeyCreateOut)
async def create_workspace_api_key(
    workspace_id: str,
    payload: WorkspaceApiKeyCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ensure_human_request(request)
    workspace = get_workspace_or_404(db, workspace_id, user)
    ensure_workspace_role(workspace, user, {"owner", "admin"})
    label = payload.label.strip()
    if len(label) < 3:
        raise HTTPException(status_code=400, detail="The API key label must be at least 3 characters.")

    raw_key = f"sk_workspace_{secrets.token_urlsafe(24)}"
    item = WorkspaceApiKey(
        workspace_id=workspace.id,
        created_by_user_id=user.id,
        label=label,
        key_prefix=raw_key[:16],
        key_hash=hash_api_key(raw_key),
    )
    db.add(item)
    create_audit_log(
        db,
        workspace_id=workspace.id,
        actor_user_id=user.id,
        action="workspace.api_key_created",
        target_type="api_key",
        target_value=label,
        metadata={"key_prefix": item.key_prefix},
    )
    db.commit()
    db.refresh(item)
    return WorkspaceApiKeyCreateOut(api_key=raw_key, item=serialize_workspace_api_key(item))


@app.get("/workspaces/{workspace_id}/observability", response_model=WorkspaceObservabilityOut)
async def workspace_observability(
    workspace_id: str,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ensure_human_request(request)
    workspace = get_workspace_or_404(db, workspace_id, user)
    ensure_workspace_role(workspace, user, {"owner", "admin"})
    logs = db.scalars(
        select(RequestLog)
        .where(RequestLog.workspace_id == workspace.id)
        .order_by(RequestLog.created_at.desc())
    ).all()

    total_requests = len(logs)
    error_requests = sum(1 for log in logs if log.status_code >= 400)
    avg_duration_ms = int(sum(log.duration_ms for log in logs) / total_requests) if total_requests else 0
    top_path_counts: dict[str, int] = {}
    auth_mode_breakdown: dict[str, int] = {}
    recent_errors: list[str] = []
    for log in logs:
        top_path_counts[log.path] = top_path_counts.get(log.path, 0) + 1
        auth_mode = log.auth_mode or "unknown"
        auth_mode_breakdown[auth_mode] = auth_mode_breakdown.get(auth_mode, 0) + 1
        if log.status_code >= 400 and len(recent_errors) < 5:
            recent_errors.append(f"{log.method} {log.path} -> {log.status_code}")
    top_paths = [
        item[0]
        for item in sorted(top_path_counts.items(), key=lambda pair: pair[1], reverse=True)[:5]
    ]
    return WorkspaceObservabilityOut(
        workspace_id=workspace.id,
        total_requests=total_requests,
        error_requests=error_requests,
        avg_duration_ms=avg_duration_ms,
        last_request_at=isoformat(logs[0].created_at) if logs else None,
        top_paths=top_paths,
        auth_mode_breakdown=auth_mode_breakdown,
        recent_errors=recent_errors,
    )


@app.get("/workspaces/{workspace_id}/request-logs", response_model=RequestLogPageOut)
async def workspace_request_logs(
    workspace_id: str,
    request: Request,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    status_code: int | None = Query(default=None),
    auth_mode: str | None = Query(default=None),
    path_query: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ensure_human_request(request)
    workspace = get_workspace_or_404(db, workspace_id, user)
    ensure_workspace_role(workspace, user, {"owner", "admin"})
    logs, total = get_workspace_request_logs(
        db,
        workspace.id,
        limit=limit,
        offset=offset,
        status_code=status_code,
        auth_mode=auth_mode,
        path_query=path_query.strip() if path_query else None,
    )
    next_offset = offset + limit if offset + limit < total else None
    return RequestLogPageOut(
        items=serialize_request_log_entries(db, logs),
        total=total,
        limit=limit,
        offset=offset,
        next_offset=next_offset,
        previous_offset=max(offset - limit, 0) if offset > 0 else None,
    )


@app.get("/workspaces/{workspace_id}/request-logs.csv")
async def workspace_request_logs_csv(
    workspace_id: str,
    request: Request,
    limit: int = Query(default=200, ge=1, le=1000),
    status_code: int | None = Query(default=None),
    auth_mode: str | None = Query(default=None),
    path_query: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ensure_human_request(request)
    workspace = get_workspace_or_404(db, workspace_id, user)
    ensure_workspace_role(workspace, user, {"owner", "admin"})
    logs = serialize_request_log_entries(
        db,
        get_workspace_request_logs(
            db,
            workspace.id,
            limit=limit,
            offset=0,
            status_code=status_code,
            auth_mode=auth_mode,
            path_query=path_query.strip() if path_query else None,
        )[0],
    )
    rows = [
        "id,created_at,method,path,status_code,duration_ms,auth_mode,user_email,api_key_label"
    ]
    for log in logs:
        rows.append(
            ",".join(
                [
                    str(log.id),
                    json.dumps(log.created_at),
                    json.dumps(log.method),
                    json.dumps(log.path),
                    str(log.status_code),
                    str(log.duration_ms),
                    json.dumps(log.auth_mode or ""),
                    json.dumps(log.user_email or ""),
                    json.dumps(log.api_key_label or ""),
                ]
            )
        )
    return PlainTextResponse(
        "\n".join(rows),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="workspace-{workspace.id}-request-logs.csv"'
        },
    )


@app.delete("/workspaces/{workspace_id}/api-keys/{api_key_id}", response_model=WorkspaceApiKeyOut)
async def revoke_workspace_api_key(
    workspace_id: str,
    api_key_id: str,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ensure_human_request(request)
    workspace = get_workspace_or_404(db, workspace_id, user)
    ensure_workspace_role(workspace, user, {"owner", "admin"})
    item = db.get(WorkspaceApiKey, api_key_id)
    if not item or item.workspace_id != workspace.id:
        raise HTTPException(status_code=404, detail="The API key was not found.")
    item.status = "revoked"
    create_audit_log(
        db,
        workspace_id=workspace.id,
        actor_user_id=user.id,
        action="workspace.api_key_revoked",
        target_type="api_key",
        target_value=item.label,
        metadata={"key_prefix": item.key_prefix},
    )
    db.commit()
    db.refresh(item)
    return serialize_workspace_api_key(item)


@app.post("/workspaces/{workspace_id}/email-jobs/{job_id}/retry", response_model=EmailDeliveryJobOut)
async def retry_workspace_email_job(
    workspace_id: str,
    job_id: str,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ensure_human_request(request)
    workspace = get_workspace_or_404(db, workspace_id, user)
    ensure_workspace_role(workspace, user, {"owner", "admin"})
    job = db.get(EmailDeliveryJob, job_id)
    if not job or job.workspace_id != workspace.id:
        raise HTTPException(status_code=404, detail="The email job was not found.")

    job.status = "pending"
    job.error_message = None
    job.updated_at = utc_now()
    try:
        job.status = "processing"
        job.processing_started_at = utc_now()
        job.worker_name = "manual-retry"
        deliver_email_job(job)
        job.status = "sent"
        job.sent_at = utc_now()
        job.processed_at = utc_now()
        job.error_message = None
    except Exception as exc:
        job.status = "failed"
        job.error_message = str(exc)
        job.processed_at = utc_now()
    job.attempt_count += 1
    job.updated_at = utc_now()
    create_audit_log(
        db,
        workspace_id=workspace.id,
        actor_user_id=user.id,
        action="workspace.email_job_retried",
        target_type="email_job",
        target_value=job.id,
        metadata={"status": job.status},
    )
    db.commit()
    db.refresh(job)
    return serialize_email_job(job)


@app.get("/workspace-invitations", response_model=list[WorkspaceInviteOut])
async def list_workspace_invitations(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    invites = db.scalars(
        select(WorkspaceInviteRequest)
        .where(
            WorkspaceInviteRequest.email == user.email.lower(),
            WorkspaceInviteRequest.status == "pending",
        )
        .order_by(WorkspaceInviteRequest.created_at.desc())
    ).all()
    workspace_map = {
        workspace.id: workspace
        for workspace in db.scalars(
            select(Workspace).where(Workspace.id.in_([invite.workspace_id for invite in invites]))
        ).all()
    }
    return [
        serialize_workspace_invite(invite, workspace_map[invite.workspace_id].name)
        for invite in invites
        if invite.workspace_id in workspace_map
    ]


@app.get("/workspace-invitations/{token}", response_model=PublicWorkspaceInviteOut)
async def get_workspace_invitation(token: str, db: Session = Depends(get_db)):
    invite = db.scalar(select(WorkspaceInviteRequest).where(WorkspaceInviteRequest.token == token))
    if not invite:
        raise HTTPException(status_code=404, detail="The invite was not found.")
    workspace = db.get(Workspace, invite.workspace_id)
    if not workspace:
        raise HTTPException(status_code=404, detail="The destination workspace was not found.")
    return serialize_public_workspace_invite(invite, workspace.name)


@app.post("/workspace-invitations/{token}/accept", response_model=WorkspaceInvitationActionOut)
async def accept_workspace_invitation(
    token: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    invite = db.scalar(select(WorkspaceInviteRequest).where(WorkspaceInviteRequest.token == token))
    if not invite or invite.status != "pending":
        raise HTTPException(status_code=404, detail="The invite was not found or has already been processed.")
    if invite.email != user.email.lower():
        raise HTTPException(status_code=403, detail="This invite is not intended for your account.")

    workspace = db.get(Workspace, invite.workspace_id)
    if not workspace:
        raise HTTPException(status_code=404, detail="The destination workspace was not found.")

    existing_member = db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.user_id == user.id,
        )
    )
    if not existing_member:
        db.add(WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role=invite.role))

    invite.status = "accepted"
    invite.responded_at = utc_now()
    create_audit_log(
        db,
        workspace_id=workspace.id,
        actor_user_id=user.id,
        action="workspace.invite_accepted",
        target_type="invite",
        target_value=user.email,
        metadata={"role": invite.role},
    )
    db.commit()
    return WorkspaceInvitationActionOut(
        ok=True,
        status="accepted",
        workspace_id=workspace.id,
        workspace_name=workspace.name,
    )


@app.post("/workspace-invitations/{token}/reject", response_model=WorkspaceInvitationActionOut)
async def reject_workspace_invitation(
    token: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    invite = db.scalar(select(WorkspaceInviteRequest).where(WorkspaceInviteRequest.token == token))
    if not invite or invite.status != "pending":
        raise HTTPException(status_code=404, detail="The invite was not found or has already been processed.")
    if invite.email != user.email.lower():
        raise HTTPException(status_code=403, detail="This invite is not intended for your account.")

    workspace = db.get(Workspace, invite.workspace_id)
    if not workspace:
        raise HTTPException(status_code=404, detail="The destination workspace was not found.")

    invite.status = "rejected"
    invite.responded_at = utc_now()
    create_audit_log(
        db,
        workspace_id=workspace.id,
        actor_user_id=user.id,
        action="workspace.invite_rejected",
        target_type="invite",
        target_value=user.email,
        metadata={"role": invite.role},
    )
    db.commit()
    return WorkspaceInvitationActionOut(
        ok=True,
        status="rejected",
        workspace_id=workspace.id,
        workspace_name=workspace.name,
    )


@app.post("/workspaces/{workspace_id}/members", response_model=WorkspaceDetail)
async def invite_workspace_member(
    workspace_id: str,
    payload: WorkspaceInvite,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ensure_human_request(request)
    workspace = get_workspace_or_404(db, workspace_id, user)
    actor = ensure_workspace_role(workspace, user, {"owner", "admin"})
    invite_role = payload.role.strip().lower()
    if invite_role not in ALLOWED_WORKSPACE_ROLES - {"owner"}:
        raise HTTPException(status_code=400, detail="The invite role is invalid.")
    if actor.role != "owner" and invite_role == "admin":
        raise HTTPException(status_code=403, detail="Only the owner can add an admin.")

    invited_email = payload.email.lower()
    invited_user = db.scalar(select(User).where(User.email == invited_email))
    if invited_user:
        existing_member = db.scalar(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace.id,
                WorkspaceMember.user_id == invited_user.id,
            )
        )
        if existing_member:
            raise HTTPException(status_code=409, detail="The user is already in the workspace.")

    pending_invite = db.scalar(
        select(WorkspaceInviteRequest).where(
            WorkspaceInviteRequest.workspace_id == workspace.id,
            WorkspaceInviteRequest.email == invited_email,
            WorkspaceInviteRequest.status == "pending",
        )
    )
    if pending_invite:
        raise HTTPException(status_code=409, detail="A pending invite already exists for this email.")

    invite = WorkspaceInviteRequest(
        workspace_id=workspace.id,
        email=invited_email,
        role=invite_role,
        token=secrets.token_urlsafe(24),
        invited_by_user_id=user.id,
    )
    db.add(invite)
    db.flush()
    email_job = create_invite_email_job(db, invite, workspace.name)
    email_sent = False
    try:
        deliver_email_job(email_job)
        email_job.status = "sent"
        email_job.sent_at = utc_now()
        email_job.updated_at = utc_now()
        email_sent = True
    except Exception as exc:
        email_job.status = "failed" if SMTP_HOST else "pending"
        email_job.error_message = str(exc) if SMTP_HOST else "SMTP is not configured yet."
        email_job.updated_at = utc_now()
        email_sent = False
    create_audit_log(
        db,
        workspace_id=workspace.id,
        actor_user_id=user.id,
        action="workspace.invite_created",
        target_type="invite",
        target_value=invited_email,
        metadata={"role": invite_role, "email_sent": email_sent},
    )
    db.commit()
    db.refresh(workspace)
    return serialize_workspace_detail(workspace, user.id)


@app.post("/workspaces/{workspace_id}/members/{member_email}/role", response_model=WorkspaceDetail)
async def update_workspace_member_role(
    workspace_id: str,
    member_email: str,
    payload: WorkspaceRoleUpdate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ensure_human_request(request)
    workspace = get_workspace_or_404(db, workspace_id, user)
    ensure_workspace_role(workspace, user, {"owner"})

    target_user = db.scalar(select(User).where(User.email == member_email.lower()))
    if not target_user:
        raise HTTPException(status_code=404, detail="The user was not found.")

    member = db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.user_id == target_user.id,
        )
    )
    if not member:
        raise HTTPException(status_code=404, detail="The workspace member was not found.")
    if member.user_id == user.id:
        raise HTTPException(status_code=400, detail="The owner cannot change their own role.")

    next_role = payload.role.strip().lower()
    if next_role not in ALLOWED_WORKSPACE_ROLES - {"owner"}:
        raise HTTPException(status_code=400, detail="The target role is invalid.")

    member.role = next_role
    create_audit_log(
        db,
        workspace_id=workspace.id,
        actor_user_id=user.id,
        action="workspace.member_role_updated",
        target_type="user",
        target_value=target_user.email,
        metadata={"role": next_role},
    )
    db.commit()
    db.refresh(workspace)
    return serialize_workspace_detail(workspace, user.id)


@app.post("/workspaces/{workspace_id}/members/{member_email}/metadata", response_model=WorkspaceDetail)
async def update_workspace_member_metadata(
    workspace_id: str,
    member_email: str,
    payload: WorkspaceMemberMetadataUpdate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ensure_human_request(request)
    workspace = get_workspace_or_404(db, workspace_id, user)
    ensure_workspace_role(workspace, user, {"owner", "admin"})

    target_user = db.scalar(select(User).where(User.email == member_email.lower()))
    if not target_user:
        raise HTTPException(status_code=404, detail="The user was not found.")

    member = db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.user_id == target_user.id,
        )
    )
    if not member:
        raise HTTPException(status_code=404, detail="The workspace member was not found.")

    member.department = (payload.department or "").strip() or None
    member.cost_center = (payload.cost_center or "").strip() or None
    create_audit_log(
        db,
        workspace_id=workspace.id,
        actor_user_id=user.id,
        action="workspace.member_metadata_updated",
        target_type="user",
        target_value=target_user.email,
        metadata={"department": member.department, "cost_center": member.cost_center},
    )
    db.commit()
    db.refresh(workspace)
    return serialize_workspace_detail(workspace, user.id)


@app.delete("/workspaces/{workspace_id}/members/{member_email}", response_model=WorkspaceDetail)
async def remove_workspace_member(
    workspace_id: str,
    member_email: str,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ensure_human_request(request)
    workspace = get_workspace_or_404(db, workspace_id, user)
    ensure_workspace_role(workspace, user, {"owner", "admin"})

    target_user = db.scalar(select(User).where(User.email == member_email.lower()))
    if not target_user:
        raise HTTPException(status_code=404, detail="The user was not found.")

    member = db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.user_id == target_user.id,
        )
    )
    if not member:
        raise HTTPException(status_code=404, detail="The workspace member was not found.")
    if member.role == "owner":
        raise HTTPException(status_code=400, detail="The workspace owner cannot be removed.")
    if user.id == target_user.id:
        raise HTTPException(status_code=400, detail="Use a different account to remove this member.")

    create_audit_log(
        db,
        workspace_id=workspace.id,
        actor_user_id=user.id,
        action="workspace.member_removed",
        target_type="user",
        target_value=target_user.email,
        metadata={"previous_role": member.role},
    )
    db.delete(member)
    db.commit()
    db.refresh(workspace)
    return serialize_workspace_detail(workspace, user.id)


@app.get("/workspaces/{workspace_id}/audit-logs", response_model=list[AuditLogOut])
async def list_workspace_audit_logs(
    workspace_id: str,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ensure_human_request(request)
    workspace = get_workspace_or_404(db, workspace_id, user)
    ensure_workspace_role(workspace, user, {"owner", "admin"})

    logs = db.scalars(
        select(AuditLog)
        .where(AuditLog.workspace_id == workspace.id)
        .order_by(AuditLog.created_at.desc())
    ).all()
    actor_ids = {log.actor_user_id for log in logs if log.actor_user_id}
    actor_map = {
        item.id: item
        for item in db.scalars(select(User).where(User.id.in_(actor_ids))).all()
    } if actor_ids else {}
    return [
        AuditLogOut(
            id=log.id,
            action=log.action,
            target_type=log.target_type,
            target_value=log.target_value,
            metadata_json=log.metadata_json,
            metadata=json.loads(log.metadata_json or "{}"),
            actor_email=actor_map[log.actor_user_id].email if log.actor_user_id in actor_map else None,
            created_at=isoformat(log.created_at),
        )
        for log in logs[:50]
    ]


@app.get("/workspaces/{workspace_id}/subscription", response_model=WorkspaceSubscriptionSummary)
async def workspace_subscription(
    workspace_id: str,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ensure_human_request(request)
    workspace = get_workspace_or_404(db, workspace_id, user)
    return build_workspace_subscription_summary(db, workspace)


@app.post("/workspaces/{workspace_id}/subscription/checkout-mock", response_model=WorkspaceSubscriptionSummary)
async def mock_workspace_checkout(
    workspace_id: str,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ensure_human_request(request)
    workspace = get_workspace_or_404(db, workspace_id, user)
    ensure_workspace_role(workspace, user, {"owner", "admin"})

    subscription = get_or_create_workspace_subscription(db, workspace)
    if not subscription.stripe_customer_id:
        subscription.stripe_customer_id = f"cus_mock_{secrets.token_hex(6)}"
    subscription.stripe_subscription_id = f"sub_mock_{secrets.token_hex(6)}"
    subscription.provider = "stripe"
    subscription.plan_name = "Pro Team"
    subscription.status = "active"
    subscription.seats_included = max(subscription.seats_included, len(workspace.members))
    subscription.cancel_at_period_end = False
    subscription.current_period_end = utc_now() + timedelta(days=30)
    subscription.updated_at = utc_now()
    create_audit_log(
        db,
        workspace_id=workspace.id,
        actor_user_id=user.id,
        action="workspace.subscription_checkout_mocked",
        target_type="subscription",
        target_value=workspace.id,
        metadata={"provider": subscription.provider, "plan_name": subscription.plan_name},
    )
    db.commit()
    return build_workspace_subscription_summary(db, workspace)


@app.post("/billing/webhooks/stripe", response_model=WorkspaceSubscriptionSummary)
async def stripe_webhook_mock(
    payload: StripeWebhookPayload,
    stripe_signature: str | None = Header(default=None, alias="Stripe-Signature"),
    db: Session = Depends(get_db),
):
    if stripe_signature != STRIPE_WEBHOOK_SECRET:
        raise HTTPException(status_code=401, detail="The Stripe signature is invalid.")

    workspace = db.get(Workspace, payload.workspace_id)
    if not workspace:
        raise HTTPException(status_code=404, detail="The workspace was not found.")

    subscription = get_or_create_workspace_subscription(db, workspace)
    if payload.stripe_customer_id:
        subscription.stripe_customer_id = payload.stripe_customer_id
    if payload.stripe_subscription_id:
        subscription.stripe_subscription_id = payload.stripe_subscription_id
    if payload.status:
        subscription.status = payload.status
    if payload.cancel_at_period_end is not None:
        subscription.cancel_at_period_end = payload.cancel_at_period_end
    if payload.current_period_end:
        subscription.current_period_end = datetime.fromisoformat(
            payload.current_period_end.replace("Z", "+00:00")
        )
    subscription.provider = "stripe"
    subscription.updated_at = utc_now()
    create_audit_log(
        db,
        workspace_id=workspace.id,
        actor_user_id=None,
        action=f"billing.webhook.{payload.event_type}",
        target_type="subscription",
        target_value=workspace.id,
        metadata={
            "status": subscription.status,
            "stripe_customer_id": subscription.stripe_customer_id,
            "stripe_subscription_id": subscription.stripe_subscription_id,
        },
    )
    db.commit()

    admin_user = db.scalar(
        select(User).where(User.id == workspace.owner_user_id)
    )
    if not admin_user:
        raise HTTPException(status_code=404, detail="The workspace owner was not found.")
    return build_workspace_subscription_summary(db, workspace)


@app.get("/workspaces/{workspace_id}/billing", response_model=WorkspaceBillingSummary)
async def workspace_billing(
    workspace_id: str,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ensure_human_request(request)
    workspace = get_workspace_or_404(db, workspace_id, user)
    return build_workspace_billing_summary(db, workspace)


@app.get("/workspaces/{workspace_id}/invoices/current", response_model=WorkspaceInvoiceSummaryOut)
async def workspace_current_invoice(
    workspace_id: str,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ensure_human_request(request)
    workspace = get_workspace_or_404(db, workspace_id, user)
    ensure_workspace_role(workspace, user, {"owner", "admin"})
    return build_workspace_invoice_summary(db, workspace)


@app.get("/workspaces/{workspace_id}/invoices/history", response_model=list[WorkspaceInvoiceSummaryOut])
async def workspace_invoice_history(
    workspace_id: str,
    request: Request,
    months: int = Query(default=6, ge=1, le=12),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ensure_human_request(request)
    workspace = get_workspace_or_404(db, workspace_id, user)
    ensure_workspace_role(workspace, user, {"owner", "admin"})
    invoices: list[WorkspaceInvoiceSummaryOut] = []
    for offset in range(0, -months, -1):
        period_start, period_end = month_window(offset)
        invoices.append(
            build_workspace_invoice_summary(
                db,
                workspace,
                period_start=period_start,
                period_end=period_end,
                period_label=period_start.strftime("%B %Y"),
            )
        )
    return invoices


@app.get("/workspaces/{workspace_id}/invoices/current.csv")
async def workspace_current_invoice_csv(
    workspace_id: str,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ensure_human_request(request)
    workspace = get_workspace_or_404(db, workspace_id, user)
    ensure_workspace_role(workspace, user, {"owner", "admin"})
    invoice = build_workspace_invoice_summary(db, workspace)
    rows = ["label,quantity,unit,amount_usd"]
    for item in invoice.line_items:
        rows.append(
            ",".join(
                [
                    json.dumps(item.label),
                    str(item.quantity),
                    json.dumps(item.unit),
                    f"{item.amount_usd:.4f}",
                ]
            )
        )
    rows.extend(
        [
            "",
            f"workspace,{json.dumps(invoice.workspace_name)}",
            f"period_start,{json.dumps(invoice.period_start)}",
            f"period_end,{json.dumps(invoice.period_end)}",
            f"token_usage,{invoice.token_usage}",
            f"request_count,{invoice.request_count}",
            f"api_key_request_count,{invoice.api_key_request_count}",
            f"total_usd,{invoice.total_usd:.4f}",
        ]
    )
    return PlainTextResponse(
        "\n".join(rows),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="workspace-{workspace.id}-invoice-current.csv"'
        },
    )


@app.get("/analytics/overview", response_model=AnalyticsOverview)
async def analytics_overview(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    workspace = Depends(get_active_workspace),
):
    user_conversations = db.scalars(
        select(Conversation).where(Conversation.workspace_id == workspace.id)
    ).all()
    documents = [document for conversation in user_conversations for document in conversation.documents]
    messages = [message for conversation in user_conversations for message in conversation.messages]
    usage_events = db.scalars(
        select(UsageEvent).where(UsageEvent.workspace_id == workspace.id)
    ).all()

    prompt_tokens = sum(
        event.tokens_estimate for event in usage_events if event.event_type in {"chat_prompt", "embedding_chunk"}
    )
    completion_tokens = sum(
        event.tokens_estimate for event in usage_events if event.event_type == "chat_completion"
    )
    prompt_cost = sum(
        event.cost_estimate_usd
        for event in usage_events
        if event.event_type in {"chat_prompt", "embedding_chunk"}
    )
    completion_cost = sum(
        event.cost_estimate_usd
        for event in usage_events
        if event.event_type == "chat_completion"
    )

    return AnalyticsOverview(
        conversation_count=len(user_conversations),
        document_count=len(documents),
        message_count=len(messages),
        assistant_message_count=sum(1 for message in messages if message.role == "assistant"),
        total_chunks=sum(len(document.chunks) for document in documents),
        total_usage_events=len(usage_events),
        estimated_total_tokens=prompt_tokens + completion_tokens,
        estimated_prompt_tokens=prompt_tokens,
        estimated_completion_tokens=completion_tokens,
        estimated_total_cost_usd=round(prompt_cost + completion_cost, 6),
        estimated_prompt_cost_usd=round(prompt_cost, 6),
        estimated_completion_cost_usd=round(completion_cost, 6),
        chats_sent=sum(1 for event in usage_events if event.event_type == "chat_prompt"),
        documents_uploaded=sum(1 for event in usage_events if event.event_type == "document_upload"),
    )


@app.get("/admin/analytics", response_model=AdminAnalyticsOverview)
async def admin_analytics(
    request: Request,
    db: Session = Depends(get_db),
    admin_user: User = Depends(get_admin_user),
):
    del admin_user
    ensure_human_request(request)
    users = db.scalars(select(User).order_by(User.created_at.asc())).all()
    conversations = db.scalars(select(Conversation)).all()
    documents = db.scalars(select(Document)).all()
    messages = db.scalars(select(Message)).all()
    usage_events = db.scalars(select(UsageEvent)).all()

    top_users: list[AdminUserAnalytics] = []
    for user in users:
        user_conversations = [conversation for conversation in conversations if conversation.user_id == user.id]
        conversation_ids = {conversation.id for conversation in user_conversations}
        user_documents = [document for document in documents if document.conversation_id in conversation_ids]
        user_usage = [event for event in usage_events if event.user_id == user.id]
        top_users.append(
            AdminUserAnalytics(
                email=user.email,
                name=user.name,
                conversation_count=len(user_conversations),
                document_count=len(user_documents),
                estimated_total_tokens=sum(event.tokens_estimate for event in user_usage),
                estimated_total_cost_usd=round(
                    sum(event.cost_estimate_usd for event in user_usage),
                    6,
                ),
            )
        )

    top_users.sort(
        key=lambda item: (item.estimated_total_cost_usd, item.estimated_total_tokens),
        reverse=True,
    )

    return AdminAnalyticsOverview(
        user_count=len(users),
        conversation_count=len(conversations),
        document_count=len(documents),
        message_count=len(messages),
        usage_event_count=len(usage_events),
        estimated_total_tokens=sum(event.tokens_estimate for event in usage_events),
        estimated_total_cost_usd=round(sum(event.cost_estimate_usd for event in usage_events), 6),
        top_users=top_users[:5],
    )


@app.get("/conversations", response_model=list[ConversationSummary])
async def list_conversations(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    workspace = Depends(get_active_workspace),
):
    conversations = db.scalars(
        select(Conversation)
        .where(Conversation.workspace_id == workspace.id)
        .order_by(Conversation.updated_at.desc())
    ).all()
    return [serialize_conversation(conversation) for conversation in conversations]


@app.post("/conversations", response_model=ConversationDetail)
async def create_conversation(
    payload: ConversationCreate | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    workspace = Depends(get_active_workspace),
):
    conversation = create_starter_conversation(db, user, workspace, payload.title if payload else None)
    return serialize_conversation_detail(conversation)


@app.get("/conversations/{conversation_id}", response_model=ConversationDetail)
async def get_conversation(
    conversation_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    workspace = Depends(get_active_workspace),
):
    conversation = get_conversation_or_404(db, conversation_id, user.id, workspace.id)
    return serialize_conversation_detail(conversation)


@app.get("/workspaces/{workspace_id}/documents", response_model=list[WorkspaceDocumentOut])
async def get_workspace_documents(
    workspace_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    workspace = get_workspace_or_404(db, workspace_id, user)
    documents = list_workspace_documents(db, workspace.id)
    return [serialize_workspace_document(document) for document in documents]


@app.post("/conversations/{conversation_id}/reset", response_model=ConversationDetail)
async def reset_conversation(
    conversation_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    workspace = Depends(get_active_workspace),
):
    conversation = get_conversation_or_404(db, conversation_id, user.id, workspace.id)
    conversation.title = "Chat baru"
    conversation.updated_at = utc_now()
    conversation.messages.clear()
    conversation.messages.append(Message(role="assistant", content=STARTER_MESSAGE))
    db.commit()
    db.refresh(conversation)
    return serialize_conversation_detail(conversation)


@app.delete("/conversations/{conversation_id}")
async def delete_conversation(
    conversation_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    workspace = Depends(get_active_workspace),
):
    conversation = get_conversation_or_404(db, conversation_id, user.id, workspace.id)
    db.delete(conversation)
    db.commit()
    return {"ok": True}


@app.post("/conversations/{conversation_id}/documents", response_model=DocumentOut)
async def upload_document(
    conversation_id: str,
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    workspace = Depends(get_active_workspace),
):
    conversation = get_conversation_or_404(db, conversation_id, user.id, workspace.id)
    enforce_workspace_document_quota(db, conversation.workspace_id)
    try:
        content = read_document_content(file)

        document = Document(
            workspace_id=conversation.workspace_id,
            conversation_id=conversation.id,
            name=file.filename or "document",
            content=content,
        )
        db.add(document)
        db.flush()

        chunks = chunk_text(content)
        if not chunks:
            raise HTTPException(status_code=400, detail="The document does not contain processable content.")

        for index, chunk in enumerate(chunks):
            embedding = create_embedding(chunk)
            chunk_record = DocumentChunk(
                position=index,
                content=chunk,
                embedding_json=json.dumps(embedding),
                norm=vector_norm(embedding),
            )
            document.chunks.append(chunk_record)
            db.flush()
            if USE_NATIVE_PGVECTOR:
                try:
                    with db.begin_nested():
                        db.execute(
                            text(
                                """
                                UPDATE document_chunks
                                SET embedding_vector = CAST(:vector AS vector)
                                WHERE id = :chunk_id
                                """
                            ),
                            {
                                "vector": embedding_literal(embedding),
                                "chunk_id": chunk_record.id,
                            },
                        )
                except Exception:
                    pass
            create_usage_event(
                db,
                user_id=user.id,
                workspace_id=conversation.workspace_id,
                conversation_id=conversation.id,
                event_type="embedding_chunk",
                tokens_estimate=estimate_tokens(chunk),
                metadata=build_usage_metadata(
                    request,
                    {"document_name": document.name, "position": index},
                ),
            )

        conversation.updated_at = utc_now()
        create_usage_event(
            db,
            user_id=user.id,
            workspace_id=conversation.workspace_id,
            conversation_id=conversation.id,
            event_type="document_upload",
            metadata=build_usage_metadata(
                request,
                {"document_name": document.name, "chunk_count": len(chunks)},
            ),
        )
        db.commit()
        db.refresh(document)
        return serialize_document(document)
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"An error occurred while processing the document: {exc}",
        ) from exc


@app.delete("/documents/{document_id}")
async def delete_document(
    document_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    document = db.get(Document, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="The document was not found.")
    workspace_id = document.workspace_id or document.conversation.workspace_id
    if workspace_id:
        workspace = get_workspace_or_404(db, workspace_id, user)
        ensure_workspace_role(workspace, user, {"owner", "admin", "member"})
    elif document.conversation.user_id != user.id:
        raise HTTPException(status_code=404, detail="The document was not found.")
    document.conversation.updated_at = utc_now()
    db.delete(document)
    db.commit()
    return {"ok": True}


@app.post("/conversations/{conversation_id}/chat")
async def chat(
    conversation_id: str,
    payload: ChatCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    workspace = Depends(get_active_workspace),
):
    prompt = payload.content.strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="The message cannot be empty.")

    conversation = get_conversation_or_404(db, conversation_id, user.id, workspace.id)
    enforce_workspace_token_quota(db, conversation.workspace_id, estimate_tokens(prompt))
    conversation.messages.append(Message(role="user", content=prompt))
    conversation.updated_at = utc_now()
    if conversation.title == "Chat baru":
        conversation.title = summarize_title(prompt)
    create_usage_event(
        db,
        user_id=user.id,
        workspace_id=conversation.workspace_id,
        conversation_id=conversation.id,
        event_type="chat_prompt",
        tokens_estimate=estimate_tokens(prompt),
        metadata=build_usage_metadata(
            request,
            {"document_count": len(conversation.documents)},
        ),
    )
    db.commit()
    db.refresh(conversation)

    context = build_context(db, conversation, prompt)
    model_messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    if context:
        model_messages.append(
            {
                "role": "system",
                "content": (
                    "Use the following document context when it is relevant. "
                    "Do not invent details that are not present.\n\n"
                    f"{context}"
                ),
            }
        )
    model_messages.extend(
        {"role": message.role, "content": message.content}
        for message in conversation.messages
    )

    demo_reply: str | None = None
    try:
        client = get_openai_client()
        stream = client.chat.completions.create(
            model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
            temperature=0.7,
            stream=True,
            messages=model_messages,
        )
    except HTTPException as exc:
        if demo_ai_enabled():
            demo_reply = (
                f"{demo_ai_reason(exc.detail if isinstance(exc.detail, str) else 'the configuration is not ready yet')}\n\n"
                f"{build_demo_reply(prompt, context)}"
            )
        else:
            raise
    except AuthenticationError as exc:
        if demo_ai_enabled():
            demo_reply = (
                f"{demo_ai_reason('the API key is not valid yet')}\n\n"
                f"{build_demo_reply(prompt, context)}"
            )
        else:
            raise HTTPException(
                status_code=500,
                detail="OPENAI_API_KEY is invalid. Update backend/.env with a valid OpenAI API key.",
            ) from exc
    except APIConnectionError as exc:
        if demo_ai_enabled():
            demo_reply = (
                f"{demo_ai_reason('the connection to OpenAI failed')}\n\n"
                f"{build_demo_reply(prompt, context)}"
            )
        else:
            raise HTTPException(
                status_code=502,
                detail="The backend could not reach OpenAI. Check the internet connection or firewall.",
            ) from exc
    except RateLimitError as exc:
        if demo_ai_enabled():
            demo_reply = (
                f"{demo_ai_reason('the API is rate limited or billing is active but constrained')}\n\n"
                f"{build_demo_reply(prompt, context)}"
            )
        else:
            raise HTTPException(
                status_code=429,
                detail="The request to OpenAI is currently rate limited. Please try again shortly.",
            ) from exc
    except (BadRequestError, NotFoundError) as exc:
        if demo_ai_enabled():
            demo_reply = (
                f"{demo_ai_reason('the AI model configuration does not match yet')}\n\n"
                f"{build_demo_reply(prompt, context)}"
            )
        else:
            raise HTTPException(
                status_code=500,
                detail=(
                    "The AI model configuration is invalid. "
                    "Check OPENAI_MODEL and make sure the model is available for this API key."
                ),
            ) from exc
    except Exception as exc:
        if demo_ai_enabled():
            demo_reply = (
                f"{demo_ai_reason('the live AI service is currently unavailable')}\n\n"
                f"{build_demo_reply(prompt, context)}"
            )
        else:
            raise HTTPException(
                status_code=500,
                detail=f"An error occurred while contacting the AI model: {exc}",
            ) from exc

    def generate() -> Generator[str, None, None]:
        assistant_chunks: list[str] = []
        try:
            if demo_reply is not None:
                for paragraph in demo_reply.split("\n\n"):
                    text = paragraph.strip()
                    if not text:
                        continue
                    emitted = f"{text}\n\n"
                    assistant_chunks.append(emitted)
                    yield emitted
                    time.sleep(0.04)
            else:
                for chunk in stream:
                    text = chunk.choices[0].delta.content or ""
                    if text:
                        assistant_chunks.append(text)
                        yield text
        finally:
            full_reply = "".join(assistant_chunks).strip()
            if full_reply:
                save_db = SessionLocal()
                try:
                    saved_conversation = get_conversation_or_404(
                        save_db,
                        conversation_id,
                        user.id,
                        conversation.workspace_id,
                    )
                    can_persist_reply = True
                    try:
                        enforce_workspace_token_quota(
                            save_db,
                            saved_conversation.workspace_id,
                            estimate_tokens(full_reply),
                        )
                    except HTTPException:
                        can_persist_reply = False
                    if can_persist_reply:
                        saved_conversation.messages.append(
                            Message(role="assistant", content=full_reply)
                        )
                        saved_conversation.updated_at = utc_now()
                        create_usage_event(
                            save_db,
                            user_id=user.id,
                            workspace_id=saved_conversation.workspace_id,
                            conversation_id=conversation_id,
                            event_type="chat_completion",
                            tokens_estimate=estimate_tokens(full_reply),
                            metadata=build_usage_metadata(
                                request,
                                {"chars": len(full_reply)},
                            ),
                        )
                        save_db.commit()
                finally:
                    save_db.close()

    return StreamingResponse(
        generate(),
        media_type="text/plain; charset=utf-8",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "X-AI-Mode": "demo" if demo_reply is not None else "live",
        },
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(_, exc: HTTPException):
    return PlainTextResponse(str(exc.detail), status_code=exc.status_code)
