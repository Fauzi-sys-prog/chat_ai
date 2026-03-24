import { InviteAcceptance } from "@/components/invite-acceptance";

type InvitePageProps = {
  params: Promise<{
    token: string;
  }>;
};

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;
  return <InviteAcceptance token={token} />;
}
