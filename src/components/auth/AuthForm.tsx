"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { forgotPassword, login, resetPassword, signup, verifyEmail } from "@/lib/api";
import { saveAuth } from "@/lib/auth";
import toast from "react-hot-toast";

const schemas = {
  signup: z.object({ name: z.string().min(2), email: z.string().email(), password: z.string().min(8), confirmPassword: z.string() }).refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match" }),
  login: z.object({ email: z.string().email(), password: z.string().min(1) }),
  verify: z.object({ otp: z.string().regex(/^\d{6}$/, "Enter the 6-digit code") }),
  forgot: z.object({ email: z.string().email() }),
  resetVerify: z.object({ otp: z.string().regex(/^\d{6}$/, "Enter the 6-digit code") }),
  reset: z.object({ newPassword: z.string().min(8), confirmPassword: z.string() }).refine((v) => v.newPassword === v.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match" }),
};
type Mode = keyof typeof schemas;
type Values = Record<string, string>;

export default function AuthForm({ mode }: { mode: Mode }) { return <Suspense fallback={<main className="auth-page"><div className="auth-card">Loading...</div></main>}><AuthFormContent mode={mode} /></Suspense>; }

function AuthFormContent({ mode }: { mode: Mode }) {
  const router = useRouter(); const params = useSearchParams(); const [busy, setBusy] = useState(false); const [apiError, setApiError] = useState("");
  const { register, handleSubmit, formState: { errors } } = useForm<Values>({ resolver: zodResolver(schemas[mode]) as never, defaultValues: { email: params.get("email") || "" } });
  async function onSubmit(values: Values) { setBusy(true); setApiError(""); try {
    if (mode === "signup") { await signup({ name: values.name, email: values.email, password: values.password }); router.push(`/verify-email?email=${encodeURIComponent(values.email)}`); }
    if (mode === "verify") { await verifyEmail({ email: params.get("email") || "", otp: values.otp }); router.push("/login"); }
    if (mode === "login") { saveAuth(await login({ email: values.email, password: values.password })); router.push("/dashboard"); }
    if (mode === "forgot") { await forgotPassword({ email: values.email }); router.push(`/reset-password/verify?email=${encodeURIComponent(values.email)}`); }
    if (mode === "resetVerify") { router.push(`/reset-password?email=${encodeURIComponent(params.get("email") || "")}&otp=${encodeURIComponent(values.otp)}`); }
    if (mode === "reset") { await resetPassword({ email: params.get("email") || "", otp: params.get("otp") || "", token: params.get("token") || undefined, newPassword: values.newPassword }); router.push("/login"); }
  } catch (error) { const message = error instanceof Error ? error.message : "Something went wrong. Please try again."; setApiError(message); toast.error(message); } finally { setBusy(false); } }
  const copy = { signup: ["Create your account", "Set up a calmer, more focused way to practise."], login: ["Welcome back", "Pick up your interview preparation where you left off."], verify: ["Verify your email", `Enter the code sent to ${params.get("email") || "your inbox"}.`], forgot: ["Reset your password", "We will send a one-time code to your email."], resetVerify: ["Enter your reset code", `Enter the 6-digit OTP sent to ${params.get("email") || "your email"}.`], reset: ["Choose a new password", "Your OTP will be verified when you save the new password."] }[mode];
  return <main className={mode === "login" ? "auth-page login-page" : "auth-page"}>{mode === "login" && <LoginShowcase />}<div className="auth-mark"><span>IS</span> Interview Studio</div><section className="auth-card"><div className="eyebrow">{mode === "verify" ? "Email verification" : "Interview practice"}</div><h1>{copy[0]}</h1><p className="muted">{copy[1]}</p>{apiError && <div className="notice error">{apiError}</div>}<form onSubmit={handleSubmit(onSubmit)} className="stack">
    {mode === "signup" && <Field label="Full name" name="name" register={register} error={errors.name?.message as string} />}
    {(mode === "signup" || mode === "login" || mode === "forgot") && <Field label="Email address" name="email" type="email" register={register} error={errors.email?.message as string} />}
    {(mode === "verify" || mode === "resetVerify") && <Field label="6-digit code" name="otp" inputMode="numeric" maxLength={6} register={register} error={errors.otp?.message as string} />}
    {(mode === "signup" || mode === "login") && <Field label="Password" name="password" type="password" register={register} error={errors.password?.message as string} />}
    {mode === "signup" && <Field label="Confirm password" name="confirmPassword" type="password" register={register} error={errors.confirmPassword?.message as string} />}
    {mode === "reset" && <><Field label="New password" name="newPassword" type="password" register={register} error={errors.newPassword?.message as string} /><Field label="Confirm password" name="confirmPassword" type="password" register={register} error={errors.confirmPassword?.message as string} /></>}
    <button className="button primary" disabled={busy}>{busy ? "Working..." : mode === "login" ? "Sign in" : mode === "verify" ? "Verify email" : mode === "forgot" ? "Send OTP" : mode === "resetVerify" ? "Continue" : mode === "reset" ? "Reset password" : "Create account"}</button>
  </form><AuthLinks mode={mode} /></section></main>;
}
function Field({ label, name, type = "text", register, error, ...props }: { label: string; name: string; type?: string; register: ReturnType<typeof useForm<Values>>["register"]; error?: string; [key: string]: unknown }) { return <label className="field">{label}<input type={type} {...register(name)} {...props} />{error && <small className="field-error">{error}</small>}</label>; }
function LoginShowcase() { return <section className="login-showcase"><div className="showcase-kicker">PRACTICE ROOM / 026</div><div className="showcase-copy"><p className="showcase-label">Thoughtful practice, in focus.</p><h2>Practice the answer<br /><em>behind</em> the answer.</h2><p>Build a sharper story with questions shaped around the work you have already done.</p></div><div className="signal-card"><div><span>SESSION STATUS</span><strong>Ready</strong></div><div className="signal-bars"><i /><i /><i /><i /><i /><i /><i /></div><small>resume-led practice / 2026</small></div><div className="showcase-footer"><span>01</span><span className="footer-line" /><span>calm preparation</span></div></section>; }
function AuthLinks({ mode }: { mode: Mode }) { if (mode === "verify") return <p className="auth-link">Wrong email? <a href="/signup">Start again</a></p>; return <p className="auth-link">{mode === "login" ? <>New here? <a href="/signup">Create an account</a> · <a href="/forgot-password">Forgot password?</a></> : <>Already have an account? <a href="/login">Sign in</a></>}</p>; }
