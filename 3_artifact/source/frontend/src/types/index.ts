import type { QuestionProposal } from "@/types/chat";

// === Auth ===
export interface User {
  id: string;
  username: string;
  display_name: string | null;
  session_expires_at: string | null;
}

export interface RegisterRequest {
  username: string;
  password: string;
  display_name?: string | null;
}

export interface LoginRequest {
  username: string;
  password: string;
}

// === Projects ===
export interface Project {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectCreate {
  name: string;
  description?: string | null;
}

export interface ProjectUpdate {
  name?: string | null;
  description?: string | null;
}

// === Sessions ===
export interface Session {
  id: string;
  project_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionDetail extends Session {
  messages: Message[];
}

export interface SessionCreate {
  project_id: string;
  title?: string | null;
}

// === Messages ===
export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  agent_name: string | null;
  tool_calls: Record<string, unknown> | null;
  proposal: QuestionProposal | null;
  created_at: string;
}

// === Artifacts ===
export type ArtifactStatus = "not_started" | "draft" | "approved";
export type Slot = "01" | "02" | "03";

/** What the source panel shows: a customer document, or the last approved version of an artifact. */
export type Source = { kind: "document"; documentId: string } | { kind: "artifact"; slot: Slot };

/** `POST /artifacts/{id}/approve`: the approved artifact plus the message written into the active chat. */
export interface ApprovedArtifact extends Artifact {
  chat_message: Message | null;
}

export interface Artifact {
  id: string;
  project_id: string;
  type: string;
  title: string;
  content: string;
  language: string | null;
  status: ArtifactStatus;
  reviewed_since_change: boolean;
  slot: Slot | null;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown> | null;
}

export interface ArtifactUpdate {
  title?: string;
  content?: string;
}

export interface ApprovedVersion {
  artifact_id: string;
  version_no: number;
  content: string;
  created_at: string;
}

// === Documents ===
export interface Document {
  id: string;
  project_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
}

// === Comments (review feedback) ===
export type CommentRole = "reviewer" | "explorer";
export type CommentStatus = "open" | "accepted" | "edited" | "rejected" | "done_manually";

export type Suggestion =
  | { kind: "text_change"; find: string; replace: string }
  | { kind: "workshop_question"; text: string };

export interface Comment {
  id: string;
  artifact_id: string;
  number: number;
  review_number: number;
  title: string;
  description: string;
  role: CommentRole;
  hypothesis: boolean;
  sources: string[];
  suggestion: Suggestion | null;
  status: CommentStatus;
  created_at: string;
}

export type CommentOutcome =
  | "applied"
  | "question_added"
  | "not_located"
  | "rejected"
  | "done_manually";

/** Answer of the four comment actions (accept, edit, reject, done-manually). */
export interface CommentAction {
  outcome: CommentOutcome;
  comment: Comment;
}

// === Runs (background workflow runs) ===
export type RunType = "draft" | "review";
export type RunState = "running" | "succeeded" | "failed";
export interface Run {
  id: string;
  project_id: string;
  type: RunType;
  slot: Slot;
  state: RunState;
  step: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}
