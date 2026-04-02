export type PropertyDto = {
  id: string;
  name: string;
  displayName: string;
  groupId: string | null;
  groupName: string | null;
  cleaningCost: number;
  exportToken: string;
  exportUrl: string;
  sourcesCount: number;
  createdAt: string;
  updatedAt: string;
};

export type PropertyCreateDto = {
  name?: string;
  displayName: string;
  groupId?: string | null;
  cleaningCost?: number;
};

export type PropertyUpdateDto = {
  displayName: string;
  groupId?: string | null;
  cleaningCost?: number;
};

export type SourceDto = {
  id: string;
  icalUrl: string;
  source: string;
  name: string;
};

export type SourceCreateDto = {
  icalUrl: string;
  source: string;
};
