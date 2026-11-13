
import type {
  DashboardData,
  GeneratedQuestionsResult,
  InterviewReport,
  LoginResult,
  ResumeUploadResult,
  User,
} from "@/types";
import { getStoredUser } from "@/lib/auth";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  "https://anytime-leone-calendars-respond.trycloudflare.com";

// This field name MUST match the backend upload middleware.
// For example: upload.single("file")
const AUDIO_FORM_FIELD = "file";

export class ApiError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
  }
}

function storedToken(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("token") || "";
}

function apiMessage(body: unknown, fallback: string): string {
  if (typeof body === "string" && body.trim()) {
    return body;
  }

  if (!body || typeof body !== "object") {
    return fallback;
  }

  const value = body as Record<string, unknown>;

  for (const key of ["message", "error", "detail", "msg"]) {
    if (typeof value[key] === "string" && value[key].trim()) {
      return value[key] as string;
    }
  }

  if (value.data && typeof value.data === "object") {
    return apiMessage(value.data, fallback);
  }

  if (Array.isArray(value.errors) && value.errors.length > 0) {
    return value.errors
      .map((item) => apiMessage(item, ""))
      .filter(Boolean)
      .join("; ");
  }

  return fallback;
}

async function readResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") || "";

  if (response.status === 204) {
    return {};
  }

  const text = await response.text();

  if (!text) {
    return {};
  }

  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  // Some servers return JSON without the correct content-type.
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function apiClient<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 90000);

  const url =
    path.startsWith("http://") || path.startsWith("https://")
      ? path
      : `${API_BASE}${path}`;

  const headers = new Headers(options.headers);

  const isFormData =
    typeof FormData !== "undefined" && options.body instanceof FormData;

  // Never manually set Content-Type for FormData.
  // The browser must add the multipart boundary automatically.
  if (!isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const token = storedToken();

  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let response: Response;

  try {
    response = await fetch(url, {
      ...options,
      headers,
      cache: "no-store",
      signal: options.signal || controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError(
        "The request timed out. Please try again.",
        408
      );
    }

    throw new ApiError(
      error instanceof Error ? error.message : "Network request failed.",
      0
    );
  } finally {
    globalThis.clearTimeout(timeout);
  }

  const body = await readResponseBody(response);

  const authRequest = path.startsWith("/api/auth/");

  if (
    response.status === 401 &&
    !authRequest &&
    typeof window !== "undefined"
  ) {
    localStorage.removeItem("token");
    document.cookie = "token=; Max-Age=0; path=/";

    window.location.replace(
      new URL("/login", window.location.origin).toString()
    );
  }

  const logicalFailure =
    typeof body === "object" &&
    body !== null &&
    (body as { success?: unknown }).success === false;

  if (!response.ok || logicalFailure) {
    throw new ApiError(
      apiMessage(body, `Request failed (${response.status})`),
      response.status
    );
  }

  return body as T;
}

const json = (body: unknown) => JSON.stringify(body);

function findResumeId(value: unknown): string {
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findResumeId(item);
      if (nested) return nested;
    }

    return "";
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  const object = value as Record<string, unknown>;

  const directKeys = [
    "resumeId",
    "resumeID",
    "resume_id",
    "resumeFileId",
    "resumeUuid",
    "resumeUUID",
    "resume_uuid",
    "fileId",
    "fileID",
    "file_id",
    "documentId",
    "document_id",
    "uploadId",
    "upload_id",
    "id",
    "_id",
  ];

  for (const key of directKeys) {
    const candidate = object[key];

    if (
      (typeof candidate === "string" ||
        typeof candidate === "number") &&
      String(candidate).trim() &&
      candidate !== "undefined" &&
      candidate !== "null"
    ) {
      return String(candidate).trim();
    }

    if (candidate && typeof candidate === "object") {
      const objectId = (candidate as Record<string, unknown>).$oid;

      if (typeof objectId === "string" && objectId.trim()) {
        return objectId.trim();
      }
    }
  }

  for (const [key, child] of Object.entries(object)) {
    if (
      [
        "resume",
        "resumeData",
        "parsedData",
        "file",
        "document",
        "upload",
        "data",
        "result",
        "metadata",
        "documentData",
      ].includes(key) ||
      /resume|file|document|upload/i.test(key)
    ) {
      if (
        (typeof child === "string" || typeof child === "number") &&
        String(child).trim()
      ) {
        return String(child).trim();
      }

      const nested = findResumeId(child);
      if (nested) return nested;
    }
  }

  return "";
}

function textField(value: unknown, keys: string[]): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  const object = value as Record<string, unknown>;

  for (const key of keys) {
    const candidate = object[key];

    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }

    if (candidate && typeof candidate === "object") {
      const nested = textField(candidate, [
        "text",
        "content",
        "answer",
        "value",
        "response",
      ]);

      if (nested) return nested;
    }
  }

  return "";
}

const requireInterviewId = (interviewId: string): string => {
  if (
    !interviewId ||
    interviewId === "undefined" ||
    interviewId === "null"
  ) {
    throw new ApiError("Interview ID is missing.", 400);
  }

  return encodeURIComponent(interviewId);
};

export const signup = (data: {
  name: string;
  email: string;
  password: string;
}) =>
  apiClient<void>("/api/auth/signup", {
    method: "POST",
    body: json(data),
  });

export const verifyEmail = (data: {
  email: string;
  otp: string;
}) =>
  apiClient<void>("/api/auth/verify-email", {
    method: "POST",
    body: json(data),
  });

type LoginApiResponse = Partial<LoginResult> & {
  accessToken?: string;
  access_token?: string;
  data?: Partial<LoginResult> & {
    accessToken?: string;
    access_token?: string;
  };
};

export async function login(data: {
  email: string;
  password: string;
}) {
  const response = await apiClient<LoginApiResponse>(
    "/api/auth/login",
    {
      method: "POST",
      body: json(data),
    }
  );

  const payload = response.data || response;

  const token =
    payload.token ||
    payload.accessToken ||
    payload.access_token;

  if (!token) {
    throw new ApiError(
      "Login succeeded but the server did not return a token.",
      502
    );
  }

  return {
    token,
    user: payload.user as LoginResult["user"],
  };
}

export const forgotPassword = (data: { email: string }) =>
  apiClient<void>("/api/auth/forgot-password", {
    method: "POST",
    body: json(data),
  });

export const resetPassword = (data: {
  email: string;
  otp: string;
  newPassword: string;
  token?: string;
}) =>
  apiClient<void>("/api/auth/reset-password", {
    method: "POST",
    body: json(data),
  });

function toNumber(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);

  return Number.isFinite(number) ? number : 0;
}

export async function getDashboard() {
  const response = await apiClient<Record<string, unknown>>(
    "/api/user/dashboard"
  );

  const data =
    (response.data as Record<string, unknown> | undefined) ||
    response;

  const dashboard =
    (data.dashboard as Record<string, unknown> | undefined) ||
    data;

  const rawInterviews = (
    dashboard.recentInterviews ||
    dashboard.interviews ||
    dashboard.recent ||
    dashboard.history ||
    []
  ) as unknown[];

  const interviews = Array.isArray(rawInterviews)
    ? rawInterviews.map((value, index) => {
        const item = value as Record<string, unknown>;

        return {
          id: String(item.id || item._id || index),
          jobRole: String(
            item.jobRole ||
              item.job_role ||
              item.role ||
              "Interview"
          ),
          score: toNumber(
            item.score ||
              item.overallScore ||
              item.overall_score
          ),
          completedAt: String(
            item.completedAt ||
              item.completed_at ||
              item.createdAt ||
              item.created_at ||
              ""
          ),
        };
      })
    : [];

  const total = toNumber(
    dashboard.totalInterviews ||
      dashboard.total_interviews ||
      dashboard.interviewCount ||
      dashboard.interview_count
  );

  const average = toNumber(
    dashboard.averageScore ||
      dashboard.average_score ||
      dashboard.avgScore ||
      dashboard.avg_score
  );

  return {
    totalInterviews: total || interviews.length,
    averageScore: average,
    recentInterviews: interviews,
  } satisfies DashboardData;
}

export async function getProfile() {
  try {
    const response = await apiClient<Record<string, unknown>>(
      "/api/user/profile"
    );

    const payload =
      (response.data as Record<string, unknown> | undefined) ||
      response;

    const user =
      (payload.user as Record<string, unknown> | undefined) ||
      payload;

    return {
      id: String(user.id || user._id || ""),
      name: String(user.name || ""),
      email: String(user.email || ""),
      createdAt: String(
        user.createdAt || user.created_at || ""
      ),
      profilePicture:
        String(
          user.profilePicture ||
            user.profile_picture ||
            user.profilePic ||
            user.profile_pic ||
            user.profileImage ||
            user.profile_image ||
            user.avatar ||
            user.image ||
            user.photo ||
            user.cloudinaryUrl ||
            ""
        ) || undefined,
    } satisfies User;
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 304) {
      const user = getStoredUser();
      if (user) return user as User;
    }

    throw error;
  }
}

export async function updateProfilePicture(file: File) {
  if (!file.type.startsWith("image/") || file.type !== "image/jpeg") {
    throw new ApiError("Please choose a JPEG image.", 400);
  }

  const updateUrl = process.env.NEXT_PUBLIC_PROFILE_UPDATE_URL;

  if (!updateUrl) {
    throw new ApiError(
      "Profile photo updates are not enabled by the backend yet.",
      501
    );
  }

  const form = new FormData();

  form.append("profilePicture", file, file.name || "profile.jpg");

  return apiClient<Record<string, unknown>>(updateUrl, {
    method: "PATCH",
    body: form,
  });
}

export async function uploadResume(
  file: File,
  jobRole?: string
) {
  const form = new FormData();

  form.append("resume", file);

  if (jobRole?.trim()) {
    form.append("jobRole", jobRole.trim());
    form.append("role", jobRole.trim());
  }

  const response = await apiClient<Record<string, unknown>>(
    "/api/interview/upload-resume",
    {
      method: "POST",
      body: form,
    }
  );

  const payload =
    (response.data as Record<string, unknown> | undefined) ||
    response;

  return {
    resumeId: findResumeId(response),
    parsedData: (payload.parsedData || {}) as Record<
      string,
      unknown
    >,
  } satisfies ResumeUploadResult;
}

export async function generateQuestions(data: {
  resumeId: string;
  jobRole: string;
  difficulty: string;
  questionCount: number;
  interviewType?: "text" | "audio";
}) {
  const response = await apiClient<Record<string, unknown>>(
    "/api/interview/generate-questions",
    {
      method: "POST",
      body: json({
        ...data,
        jobRole: data.jobRole.trim(),
        role: data.jobRole.trim(),
        interviewType: data.interviewType || "text",
      }),
    }
  );

  const payload =
    (response.data as Record<string, unknown> | undefined) ||
    response;

  const interview =
    (payload.interview as Record<string, unknown> | undefined) ||
    payload;

  const rawQuestions = (
    payload.questions ||
    interview.questions ||
    []
  ) as Record<string, unknown>[];

  return {
    interviewId: String(
      payload.interviewId ||
        interview.interviewId ||
        interview._id ||
        interview.id ||
        ""
    ),

    questions: rawQuestions.map((question, index) => ({
      id: String(question.id || question._id || index),
      text: String(question.text || question.question || ""),
      type:
        question.type === "behavioral" ||
        question.type === "situational"
          ? question.type
          : "technical",
      difficulty:
        question.difficulty === "easy" ||
        question.difficulty === "hard"
          ? question.difficulty
          : "medium",
      timeLimit:
        typeof question.timeLimit === "number"
          ? question.timeLimit
          : undefined,
    })),
  } satisfies GeneratedQuestionsResult;
}

export const submitAnswer = (
  interviewId: string,
  data: {
    questionId: string;
    answer: string;
    timeTaken: number;
  }
) =>
  apiClient<void>(
    `/api/interview/${requireInterviewId(interviewId)}/answer`,
    {
      method: "POST",
      body: json(data),
    }
  );

export async function startProctor(
  interviewId: string,
  image?: Blob
) {
  const safeInterviewId = requireInterviewId(interviewId);

  let body: FormData | undefined;

  if (image) {
    body = new FormData();
    body.append("image", image, "proctor.jpg");
  }

  return apiClient<void>(
    `/api/interview/${safeInterviewId}/proctor/start`,
    {
      method: "POST",
      body,
    }
  );
}

export async function getReport(interviewId: string) {
  const response = await apiClient<Record<string, unknown>>(
    `/api/interview/${requireInterviewId(interviewId)}/report`
  );

  const data =
    (response.data as Record<string, unknown> | undefined) ||
    response;

  const report =
    (data.report as Record<string, unknown> | undefined) ||
    data;

  const rawResults = Array.isArray(report.questionResults)
    ? report.questionResults
    : Array.isArray(report.results)
      ? report.results
      : [];

  const rawEvaluations = Array.isArray(report.questionEvaluations)
    ? report.questionEvaluations
    : [];

  const results = rawResults.length
    ? rawResults
    : rawEvaluations;

  return {
    interviewId: String(
      report.interviewId ||
        report.interview_id ||
        interviewId
    ),

    overallScore:
      typeof report.overallScore === "number"
        ? report.overallScore
        : Number(report.score || 0),

    feedback: String(
      report.feedback || "Your interview report is ready."
    ),

    questionResults: results.map((result) => {
      const item = result as Record<string, unknown>;

      const evaluation =
        (item.evaluation as Record<string, unknown> | undefined) ||
        (item.aiEvaluation as Record<string, unknown> | undefined) ||
        (item.answerEvaluation as
          | Record<string, unknown>
          | undefined) ||
        {};

      const aiAnswer =
        textField(item, [
          "aiAnswer",
          "ai_answer",
          "aiGeneratedAnswer",
          "ai_generated_answer",
          "generatedAnswer",
          "generated_answer",
          "modelAnswer",
          "model_answer",
          "referenceAnswer",
          "reference_answer",
          "expectedAnswer",
          "expected_answer",
          "sampleAnswer",
          "sample_answer",
          "suggestedAnswer",
          "suggested_answer",
          "idealAnswer",
          "ideal_answer",
        ]) ||
        textField(evaluation, [
          "answer",
          "aiAnswer",
          "generatedAnswer",
          "modelAnswer",
          "referenceAnswer",
          "expectedAnswer",
          "sampleAnswer",
          "suggestedAnswer",
          "idealAnswer",
        ]);

      const candidateAnswer = textField(item, [
        "candidateAnswer",
        "candidate_answer",
        "userAnswer",
        "user_answer",
        "submittedAnswer",
        "submitted_answer",
        "response",
        "answer",
      ]);

      return {
        questionId: String(
          item.questionId ||
            item.question_id ||
            item.id ||
            item._id ||
            item.questionIndex ||
            ""
        ),

        question: String(
          item.question ||
            item.text ||
            `Question ${String(item.questionIndex || "")}`
        ),

        answer: candidateAnswer,

        score:
          typeof item.score === "number"
            ? item.score
            : Number(item.score || 0),

        feedback: String(
          item.feedback ||
            item.evaluationText ||
            textField(evaluation, [
              "feedback",
              "text",
              "comment",
            ]) ||
            "No feedback provided."
        ),

        idealAnswer: aiAnswer || undefined,
        aiAnswer: aiAnswer || undefined,
      };
    }),

    strengths: Array.isArray(report.strengths)
      ? report.strengths.map(String)
      : [],

    improvements: Array.isArray(report.improvements)
      ? report.improvements.map(String)
      : Array.isArray(report.weaknesses)
        ? report.weaknesses.map(String)
        : [],

    completedAt: String(
      report.completedAt ||
        report.completed_at ||
        new Date().toISOString()
    ),

    candidate: (report.candidate ||
      {}) as InterviewReport["candidate"],

    jobRole: String(
      report.jobRole || report.job_role || ""
    ),

    interviewDate: String(
      report.interviewDate || report.interview_date || ""
    ),

    performanceLevel: String(
      report.performanceLevel ||
        report.performance_level ||
        ""
    ),

    summary: String(report.summary || ""),

    weaknesses: Array.isArray(report.weaknesses)
      ? report.weaknesses.map(String)
      : [],

    recommendations: Array.isArray(report.recommendations)
      ? report.recommendations.map(String)
      : [],

    proctoring: report.proctoring as
      InterviewReport["proctoring"],

    reportUrl:
      String(report.reportUrl || report.report_url || "") ||
      undefined,
  } satisfies InterviewReport;
}

export async function downloadReport(interviewId: string) {
  const safeInterviewId = requireInterviewId(interviewId);

  const response = await fetch(
    `${API_BASE}/api/interview/${safeInterviewId}/report/download`,
    {
      headers: {
        Authorization: `Bearer ${storedToken()}`,
      },
    }
  );

  if (!response.ok) {
    throw new ApiError(
      "Could not download report.",
      response.status
    );
  }

  return response.blob();
}

// ------------------------------------------
// Voice agent APIs
// ------------------------------------------

export async function suggestJobRoles(): Promise<string[]> {
  const response = await apiClient<Record<string, unknown>>(
    "/api/interview/suggest-job-roles"
  );

  const payload =
    (response.data as Record<string, unknown> | undefined) ||
    response;

  const roles =
    payload.roles ||
    payload.jobRoles ||
    payload.suggestions ||
    payload.data ||
    [];

  return Array.isArray(roles) ? roles.map(String) : [];
}

export async function getQuestionAudio(
  interviewId: string,
  questionId: string
): Promise<Blob> {
  const safeInterviewId = requireInterviewId(interviewId);

  if (!questionId || questionId === "undefined") {
    throw new ApiError("Question ID is missing.", 400);
  }

  const response = await fetch(
    `${API_BASE}/api/interview/${safeInterviewId}/questions/${encodeURIComponent(
      questionId
    )}/audio`,
    {
      headers: {
        Authorization: `Bearer ${storedToken()}`,
      },
      cache: "no-store",
    }
  );

  if (!response.ok) {
    const body = await readResponseBody(response);

    throw new ApiError(
      apiMessage(body, "Could not load question audio."),
      response.status
    );
  }

  const audioBlob = await response.blob();

  if (audioBlob.size === 0) {
    throw new ApiError(
      "The server returned an empty question audio file.",
      502
    );
  }

  return audioBlob;
}

function validateAudioBlob(audioBlob: Blob): void {
  if (!(audioBlob instanceof Blob)) {
    throw new ApiError("Invalid audio recording.", 400);
  }

  if (audioBlob.size === 0) {
    throw new ApiError(
      "Audio recording is empty. Please record your answer again.",
      400
    );
  }

  if (audioBlob.size < 100) {
    throw new ApiError(
      "Audio recording is too small. Please record your answer again.",
      400
    );
  }
}

function createAudioFormData(audioBlob: Blob): FormData {
  validateAudioBlob(audioBlob);

  const form = new FormData();

  // The backend upload middleware must expect this exact field name.
  form.append(
    AUDIO_FORM_FIELD,
    audioBlob,
    "answer.webm"
  );

  return form;
}

export async function submitAudioAnswer(
  interviewId: string,
  audioBlob: Blob
): Promise<void> {
  const safeInterviewId = requireInterviewId(interviewId);
  const form = createAudioFormData(audioBlob);

  await apiClient<void>(
    `/api/interview/${safeInterviewId}/answer/audio`,
    {
      method: "POST",
      body: form,
    }
  );
}


export async function transcribeAudioAnswer(
  interviewId: string,
  questionId: string,
  audioBlob: Blob
): Promise<string> {
  const safeInterviewId = requireInterviewId(interviewId);

  if (!questionId?.trim()) {
    throw new Error("Question ID is missing.");
  }

  if (!audioBlob || audioBlob.size === 0) {
    throw new Error("Audio recording is empty.");
  }

  const form = new FormData();

  form.append("questionId", questionId);
  form.append("audio", audioBlob, "answer.webm");

  const response = await apiClient<Record<string, unknown>>(
    `/api/interview/${safeInterviewId}/answer/audio/transcribe`,
    {
      method: "POST",
      body: form,
    }
  );

  const payload =
    (response.data as Record<string, unknown> | undefined) || response;

  const transcript =
    payload.transcript ||
    payload.text ||
    payload.transcription;

  if (typeof transcript !== "string" || !transcript.trim()) {
    console.error("Unexpected transcription response:", response);
    throw new Error("Server returned an empty or invalid transcript.");
  }

  return transcript.trim();
}
