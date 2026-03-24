import { AuthAction } from "@/components/auth-action";

type ResetPasswordPageProps = {
  params: Promise<{
    token: string;
  }>;
};

export default async function ResetPasswordPage({ params }: ResetPasswordPageProps) {
  const { token } = await params;
  return <AuthAction token={token} mode="reset_password" />;
}
