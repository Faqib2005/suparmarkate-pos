import { Loader2, QrCode, RefreshCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import type { PosSessionResponse } from "../types";

type PosQrCardProps = {
  session: PosSessionResponse["data"] | null;
  onRefresh: () => void;
};

export function PosQrCard({ session, onRefresh }: PosQrCardProps) {
  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <QrCode className="h-5 w-5" />
          اتصال موبایل
        </CardTitle>
        <CardDescription>
          این QR فقط برای وصل‌کردن اپ موبایل به همین صفحه POS و اسکن بارکود محصولات است.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {session ? (
          <>
            <div className="mx-auto w-full max-w-[220px] rounded-3xl bg-white p-4">
              <img
                src={session.connection.qrImageUrl}
                alt="کد QR صندوق فروش"
                className="block w-full"
              />
            </div>

            <div className="rounded-xl border border-border bg-background p-3">
              <div className="text-xs text-muted-foreground">شناسه نشست</div>
              <code className="block max-h-16 overflow-y-auto break-all text-left text-xs text-primary" dir="ltr">
                {session.session.id}
              </code>
            </div>
          </>
        ) : (
          <div className="grid h-[250px] place-items-center">
            <Loader2 className="h-9 w-9 animate-spin text-primary" />
          </div>
        )}

        <Button variant="secondary" onClick={onRefresh} className="w-full gap-2">
          <RefreshCcw className="h-4 w-4" />
          ساخت جلسه جدید
        </Button>
      </CardContent>
    </Card>
  );
}
