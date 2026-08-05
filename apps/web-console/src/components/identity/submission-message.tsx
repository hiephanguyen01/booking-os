import { Alert } from "@booking-os/ui/alert";

export type SubmissionState =
  | Readonly<{ state: "idle" }>
  | Readonly<{ state: "submitting" }>
  | Readonly<{ state: "success"; message: string }>
  | Readonly<{ state: "error"; message: string }>;

export function SubmissionMessage({ value }: Readonly<{ value: SubmissionState }>) {
  if (value.state === "success") {
    return (
      <Alert role="status" variant="success">
        {value.message}
      </Alert>
    );
  }

  if (value.state === "error") {
    return <Alert variant="destructive">{value.message}</Alert>;
  }

  return null;
}
