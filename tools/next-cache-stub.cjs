// A no-op stand-in for next/cache, so a "use server" action can be run from a
// plain Node script.
//
// revalidatePath reaches for the request-scoped store Next keeps during a
// render and throws an invariant when there is not one. That is the only thing
// standing between a server action and a script — the database work either
// side of it is ordinary code, and cache invalidation is not what
// tools/verify-stage-changed-at.ts is checking.
exports.revalidatePath = () => {};
exports.revalidateTag = () => {};
