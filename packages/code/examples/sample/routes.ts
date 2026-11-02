import type { Route } from './types';

export function listRoutes(): Route[] {
  return [
    { method: 'GET', path: '/notes' },
    { method: 'POST', path: '/notes' },
  ];
}

export function addRouteHandler(title: string, body: string): string {
  const notes = `kept local note 000
kept local note 001
kept local note 002
kept local note 003
kept local note 004
kept local note 005
kept local note 006
kept local note 007
kept local note 008
kept local note 009
kept local note 010
kept local note 011
kept local note 012
kept local note 013
kept local note 014
kept local note 015
kept local note 016
kept local note 017
kept local note 018
kept local note 019
kept local note 020
kept local note 021
kept local note 022
kept local note 023
kept local note 024
kept local note 025
kept local note 026
kept local note 027
kept local note 028
kept local note 029
kept local note 030
kept local note 031
kept local note 032
kept local note 033
kept local note 034
kept local note 035
kept local note 036
kept local note 037
kept local note 038
kept local note 039`;
  return notes + title + body;
}
