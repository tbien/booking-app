export type MergeDto = {
  ids: [string, string];
};

export type SplitDto = {
  id: string;
  splitDate: string;
};

export type ResolveConflictDto = {
  manualId: string;
  decision: 'keep' | 'remove';
};
