import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  /**
   * The terminal's current operator, from the `x-gt-operator` header
   * (attribution only — NOT auth; see shared/api/lib/operators.ts). Raw
   * header value; mutations validate it via resolveOperator().
   */
  operator: string | null;
};

export async function createContext(
  opts: FetchCreateContextFnOptions,
): Promise<TrpcContext> {
  const operator = opts.req.headers.get("x-gt-operator");
  return { req: opts.req, resHeaders: opts.resHeaders, operator };
}
