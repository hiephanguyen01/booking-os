import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { Alert } from "../src/components/alert.js";
import { Button } from "../src/components/button.js";
import { Card, CardContent, CardTitle } from "../src/components/card.js";
import { Input } from "../src/components/input.js";
import { Label } from "../src/components/label.js";

it("renders accessible semantic primitives", () => {
  const html = renderToStaticMarkup(
    <>
      <Label htmlFor="email">Email address</Label>
      <Input id="email" aria-invalid />
      <Button type="submit">Continue</Button>
      <Card>
        <CardTitle>Title</CardTitle>
        <CardContent>
          <Alert variant="destructive">Error</Alert>
        </CardContent>
      </Card>
    </>,
  );

  expect(html).toContain('for="email"');
  expect(html).toContain('aria-invalid="true"');
  expect(html).toContain("bg-primary");
  expect(html).toContain('role="alert"');
});
