import Joi from 'joi';

export const GUESTS_MIN = 0;
export const GUESTS_MAX = 20;
export const DEFAULT_PROPERTY_NAME = 'Nieznana';

// Helper function to map booking items to rows
export const mapBookingsToRows = (items: any[], propertyToGroupMap?: Map<string, string>) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  return items.map((it) => {
    const createdAt = new Date(it.createdAt);
    const isCreatedToday = createdAt >= today && createdAt < tomorrow;

    return {
      id: String(it._id),
      Nieruchomość: it.propertyName || DEFAULT_PROPERTY_NAME,
      'Data rozpoczęcia': new Date(it.start).toLocaleDateString('pl-PL'),
      'Data zakończenia': new Date(it.end).toLocaleDateString('pl-PL'),
      'Status wyjazdu': it.isUrgentChangeover ? 'PILNE' : 'NORMALNE',
      Opis: it.description || '',
      Źródło: it.source,
      'Liczba gości': typeof it.guests === 'number' ? it.guests : '',
      Notatki: it.notes || '',
      groupId: propertyToGroupMap ? propertyToGroupMap.get(it.propertyName) || null : undefined,
      isNew: isCreatedToday,
      createdAt: it.createdAt,
      updatedAt: it.updatedAt,
    };
  });
};

const objectIdPattern = /^[a-fA-F0-9]{24}$/;

export const guestSchema = Joi.object({
  id: Joi.string().required(),
  guests: Joi.number().integer().min(GUESTS_MIN).max(GUESTS_MAX).required(),
});

export const propertySchema = Joi.object({
  name: Joi.string().min(1).required(),
  icalUrl: Joi.string().uri().required(),
  source: Joi.string().min(1).required(),
  cleaningCost: Joi.number().min(0).default(0),
  groupId: Joi.string().pattern(objectIdPattern).allow('', null).optional(),
});

export const notesSchema = Joi.object({
  id: Joi.string().required(),
  notes: Joi.string().allow('').required(),
});
