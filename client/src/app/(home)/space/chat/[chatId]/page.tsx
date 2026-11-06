import { Suspense } from "react";
import { notFound } from "next/navigation";
import { SpaceChefMascot } from "@/modules/space/components/space-chef-mascot";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function Chat({ params }: { params: Promise<{ chatId: string }> }) {
  const { chatId } = await params;
  if (!UUID.test(chatId)) notFound();
  return <SpaceChefMascot chatId={chatId} />;
}

// `params` is request-time data, so it resolves behind Suspense and the shell prerenders
export default function ChatPage({ params }: { params: Promise<{ chatId: string }> }) {
  return (
    <div className="flex-1 w-full h-full flex">
      <Suspense fallback={null}>
        <Chat params={params} />
      </Suspense>
    </div>
  );
}
