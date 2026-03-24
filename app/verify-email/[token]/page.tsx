import { AuthAction } from "@/components/auth-action";

type VerifyEmailPageProps = {
  params: Promise<{
    token: string;
  }>;
};

export default async function VerifyEmailPage({ params }: VerifyEmailPageProps) {
  const { token } = await params;
  return <AuthAction token={token} mode="verify_email" />;
}
