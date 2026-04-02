export type BlockCreateDto = {
  propertyId: string;
  start: string;
  end: string;
  reason?: string;
};

export type BlockUpdateDto = {
  start: string;
  end: string;
  reason?: string;
};
