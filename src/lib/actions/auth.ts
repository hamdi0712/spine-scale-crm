"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { expectedSessionToken, SESSION_COOKIE } from "@/lib/auth";

export interface LoginState {
  error?: string;
}

export async function login(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const password = formData.get("password");
  if (!process.env.APP_PASSWORD) {
    return {
      error:
        "APP_PASSWORD is not set. Add it to the .env file and restart the server.",
    };
  }
  const expected = await expectedSessionToken();
  if (typeof password !== "string" || password !== process.env.APP_PASSWORD || !expected) {
    return { error: "Incorrect password." };
  }
  cookies().set(SESSION_COOKIE, expected, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect("/");
}

export async function logout() {
  cookies().delete(SESSION_COOKIE);
  redirect("/login");
}
