export type RouteMethod = 'GET' | 'POST';

export interface Route {
  method: RouteMethod;
  path: string;
}
