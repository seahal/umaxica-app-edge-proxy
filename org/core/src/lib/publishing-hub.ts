import { createServerFn } from '@tanstack/react-start';

/*
 * Worker env is read behind this RPC. The route file stays isomorphic: the
 * client bundle calls the function, the server bundle runs the handler.
 */
export const loadRailsStaffOrigin = createServerFn({ method: 'GET' }).handler(async () => {
  const { getRailsStaffOrigin } = await import('./rails-staff-origin.server');
  return getRailsStaffOrigin();
});
