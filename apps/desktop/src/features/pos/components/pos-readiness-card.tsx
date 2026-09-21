import { AlertCircle, CheckCircle2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type PosReadinessCardProps = {
  issues: string[];
  isWsConnected: boolean;
};

export function PosReadinessCard({ issues, isWsConnected }: PosReadinessCardProps) {
  const isReady = issues.length === 0;

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>وضعیت آمادهبودن صندوق</span>

          <Badge variant={isReady ? "default" : "destructive"}>
            {isReady ? "آماده" : "نیاز به توجه"}
          </Badge>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="flex items-center justify-between rounded-xl bg-secondary p-3 text-sm">
          <span className="text-muted-foreground">اتصال زنده</span>
          <Badge variant={isWsConnected ? "default" : "secondary"}>
            {isWsConnected ? "وصل" : "قطع"}
          </Badge>
        </div>

        {isReady ? (
          <Alert className="border-emerald-500/40 bg-emerald-500/10">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            <AlertTitle>صندوق آماده است</AlertTitle>
            <AlertDescription>
              میتوانید محصولات را اسکن کنید و فروش را ثبت نمایید.
            </AlertDescription>
          </Alert>
        ) : (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>صندوق هنوز کامل آماده نیست</AlertTitle>
            <AlertDescription>
              <ul className="mt-2 list-inside list-disc space-y-1">
                {issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
