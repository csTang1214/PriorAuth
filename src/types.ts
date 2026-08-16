import type { DraftStrategy } from "./stubs";

export type CaseStatus = "draft" | "submitted" | "approved" | "denied" | "partial";
export type CaseOutcome = "approved" | "denied" | "partial";

export interface Case {
  id: number;
  patient_summary: string;
  payer: string;
  plan_type: string | null;
  procedure: string;
  specialty: string | null;
  status: CaseStatus;
  draft_text: string | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  response_window_days: number | null;
  decided_at: string | null;
  generated_draft_text: string | null;
  edit_distance: number | null;
  draft_strategy: DraftStrategy | null;
}

export interface NewCaseInput {
  patient_summary: string;
  payer: string;
  plan_type: string;
  procedure: string;
  specialty: string;
}

export interface DeadlineRule {
  id: number;
  payer: string;
  plan_type: string | null;
  response_window_days: number;
  created_at: string;
}
