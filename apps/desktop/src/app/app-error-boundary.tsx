import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Props = {
  children: ReactNode;
};

type State = {
  hasError: boolean;
  message: string;
};

export class AppErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    message: "",
  };

  static getDerivedStateFromError(error: Error): State {
    void error;
    return {
      hasError: true,
      message: "خطای غیرمنتظره‌ای در بارگذاری صفحه رخ داد. لطفاً صفحه را دوباره بارگذاری کنید.",
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[desktop-pos-error]", error, info);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <main
        dir="rtl"
        className="grid min-h-screen place-items-center bg-background p-6 text-foreground"
      >
        <Card className="w-full max-w-xl border-destructive/40 bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              خطا در صفحه POS
            </CardTitle>
          </CardHeader>

          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              برنامه با خطا روبه‌رو شد، اما کل اپ بسته نشد. صفحه را تازه‌سازی کنید.
            </p>

            <pre className="max-h-44 overflow-auto rounded-xl bg-secondary p-3 text-right text-xs" dir="rtl">
              {this.state.message}
            </pre>

            <Button onClick={() => window.location.reload()} className="gap-2">
              <RefreshCcw className="h-4 w-4" />
              بارگذاری دوباره
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }
}
