import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

it("renders React components in a browser-like DOM", () => {
  render(
    <>
      <label htmlFor="email">Email address</label>
      <input id="email" />
    </>,
  );

  expect(screen.getByLabelText("Email address")).toBeTruthy();
});
