"use client";

// A date-and-time picker that posts an unambiguous instant.
//
// A datetime-local value is wall-clock text with no zone attached, so only the
// browser knows which moment "2026-08-06T09:30" means. The visible input is
// therefore never posted: it drives a hidden field carrying the ISO instant,
// which is what the server stores.

import { useState } from "react";
import { fromDateTimeLocalInput } from "@/lib/timezones";

export default function DateTimeField({
  name,
  id,
  required = false,
  defaultValue = "",
}: {
  name: string;
  id: string;
  required?: boolean;
  defaultValue?: string; // datetime-local text, in the viewer's own zone
}) {
  const [value, setValue] = useState(defaultValue);
  const picked = fromDateTimeLocalInput(value);
  return (
    <>
      <input
        id={id}
        type="datetime-local"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        required={required}
        className="field num"
      />
      <input
        type="hidden"
        name={name}
        value={picked ? picked.toISOString() : ""}
      />
    </>
  );
}
