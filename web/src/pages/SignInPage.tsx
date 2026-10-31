import { useState, type FormEvent } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Navigate } from "react-router";
import { Logo, useShell } from "@/components/Shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

type Step = "signIn" | "signUp" | "verify" | "forgot" | "reset";

const copy: Record<Step, { title: string; description: string; submit: string }> = {
  signIn: { title: "Sign in to edit", description: "Reading needs no account.", submit: "Sign in" },
  signUp: { title: "Create account", description: "Only emails on the allowlist can sign up.", submit: "Create account" },
  verify: { title: "Check your email", description: "Enter the 6-digit code we sent you.", submit: "Verify" },
  forgot: { title: "Reset password", description: "We'll email you a 6-digit code.", submit: "Send code" },
  reset: { title: "Choose a new password", description: "Enter the code from your email.", submit: "Reset password" },
};

// Each step sends one Convex Auth Password flow.
const flows: Record<Step, string> = {
  signIn: "signIn",
  signUp: "signUp",
  verify: "email-verification",
  forgot: "reset",
  reset: "reset-verification",
};

function friendly(err: unknown, step: Step): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/allowlist/i.test(raw)) return "This email is not on the allowlist.";
  if (/valid email/i.test(raw)) return "Enter a valid email address.";
  if (/at least 8/i.test(raw)) return "Password must be at least 8 characters.";
  if (/already exists/i.test(raw)) return "An account with this email already exists. Sign in instead.";
  if (/send the email/i.test(raw)) return "Could not send the email. Try again in a minute.";
  if (step === "verify" || step === "reset") return "That code is wrong or has expired.";
  if (/InvalidSecret|InvalidAccountId|Invalid password/i.test(raw)) return "Wrong email or password.";
  if (step === "forgot") return "Could not send a reset code.";
  return step === "signIn" ? "Could not sign in. Check your email and password." : "Could not create the account.";
}

/**
 * Email + password, for editing, with a code by email to verify the address at
 * sign-up (and on sign-in if it never was) and to reset a forgotten password.
 * Sign-up only works for allowlisted emails.
 */
export function SignInPage() {
  const { signIn } = useAuthActions();
  const { canEdit } = useShell();
  const [step, setStep] = useState<Step>("signIn");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (canEdit) return <Navigate to="/" replace />;

  function go(next: Step) {
    setStep(next);
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const formData = new FormData(event.currentTarget);
    formData.set("email", email);
    formData.set("flow", flows[step]);
    try {
      const { signingIn } = await signIn("password", formData);
      // Not signed in yet means a code was emailed: sign-up, an unverified
      // sign-in, or a reset request.
      if (!signingIn) go(step === "forgot" ? "reset" : "verify");
    } catch (err) {
      setError(friendly(err, step));
    } finally {
      setBusy(false);
    }
  }

  const { title, description, submit: submitLabel } = copy[step];
  const codeStep = step === "verify" || step === "reset";
  const link = "text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline";

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-8 px-4 py-10">
      <Logo />
      <div className="w-full max-w-sm space-y-6 rounded-2xl border bg-card p-6 sm:p-8">
        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{codeStep ? `${description} (${email})` : description}</p>
        </div>
        <form onSubmit={submit} key={step}>
          <FieldGroup>
            {!codeStep && (
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
            )}
            {codeStep && (
              <Field>
                <FieldLabel htmlFor="code">Code</FieldLabel>
                <Input
                  id="code"
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  autoFocus
                />
              </Field>
            )}
            {(step === "signIn" || step === "signUp" || step === "reset") && (
              <Field>
                <FieldLabel htmlFor="password">{step === "reset" ? "New password" : "Password"}</FieldLabel>
                <Input
                  id="password"
                  name={step === "reset" ? "newPassword" : "password"}
                  type="password"
                  minLength={8}
                  autoComplete={step === "signIn" ? "current-password" : "new-password"}
                  required
                />
              </Field>
            )}
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" size="lg" disabled={busy}>
              {busy && <Spinner />}
              {submitLabel}
            </Button>
            <div className="flex flex-col items-center gap-2">
              {step === "signIn" ? (
                <>
                  <button type="button" className={link} onClick={() => go("forgot")}>
                    Forgot password?
                  </button>
                  <button type="button" className={link} onClick={() => go("signUp")}>
                    First time? Create your account
                  </button>
                </>
              ) : (
                <button type="button" className={link} onClick={() => go("signIn")}>
                  Back to sign in
                </button>
              )}
            </div>
          </FieldGroup>
        </form>
      </div>
    </div>
  );
}
