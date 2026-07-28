/**
 * Validates request against a Zod schema (body/query/params). Returns a
 * 400 with a user-friendly message plus a per-field breakdown that a
 * frontend can map onto form inputs.
 */
export function validate(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse({
      body: req.body,
      query: req.query,
      params: req.params,
    });
    if (!parsed.success) {
      const flattened = parsed.error.flatten();
      const fieldErrors = flattened.fieldErrors || {};
      const formErrors = flattened.formErrors || [];

      // Build a compact list of "field: message" entries; drop empties.
      const details = [];
      for (const [field, messages] of Object.entries(fieldErrors)) {
        if (Array.isArray(messages) && messages.length > 0) {
          for (const msg of messages) details.push({ field, message: msg });
        }
      }
      for (const msg of formErrors) details.push({ field: "_form", message: msg });

      const message =
        details.length > 0 && details[0]
          ? `Please fix the highlighted field${details.length > 1 ? "s" : ""}: ${details[0].message}`
          : "Some of the information you sent is invalid. Please review and try again.";

      return res.status(400).json({
        error: message,
        code: "VALIDATION_FAILED",
        details,
      });
    }
    req.validated = parsed.data;
    next();
  };
}
