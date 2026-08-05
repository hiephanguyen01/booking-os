import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { FormField } from "../src/components/form-field.js";
import { SubmitButton } from "../src/components/submit-button.js";

it("links description and error IDs to the control", () => {
  const html = renderToStaticMarkup(
    <FormField id="password" label="Password" description="Use 12 characters" error="Too short">
      {(a11y) => <input id="password" {...a11y} />}
    </FormField>,
  );

  expect(html).toContain('aria-describedby="password-description password-error"');
  expect(html).toContain('aria-invalid="true"');
  expect(html).toContain('role="alert"');
});

it("renders a disabled pending button", () => {
  const html = renderToStaticMarkup(
    <SubmitButton idleLabel="Save" pendingLabel="Saving…" pending />,
  );

  expect(html).toContain("Saving…");
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain("disabled");
});
