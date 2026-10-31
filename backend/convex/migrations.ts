import { internalMutation } from "./_generated/server";

/**
 * One-off: marks users from before email verification as verified, so they
 * can still sign in and kunji can find them. Run once per deployment, then delete.
 */
export const markUsersVerified = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let marked = 0;
    for (const user of await ctx.db.query("users").collect()) {
      if (user.emailVerificationTime === undefined) {
        await ctx.db.patch(user._id, { emailVerificationTime: now });
        marked++;
      }
    }
    return { marked };
  },
});
