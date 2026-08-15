import type { Request, Response, NextFunction, RequestHandler } from "express";

// Express 4 does NOT forward a rejected promise from an async route handler
// to the error middleware automatically -- an uncaught async error just
// hangs the request (no response ever sent), rather than a clean 500. Wrap
// every async route with this so DB/connector errors always produce a
// response.
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
