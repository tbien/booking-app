import { AppSettings } from '../models/AppSettings';
import { SettingsDto } from '../types/api';

export class SettingsService {
  async get(): Promise<SettingsDto> {
    const settings = await AppSettings.findOne({ key: 'global' })
      .populate('defaultGroupId', 'name')
      .lean();
    if (!settings) return { defaultGroupId: null, showHolidays: true };
    const dg = (settings as any).defaultGroupId;
    return {
      defaultGroupId: dg?._id ? String(dg._id) : dg ? String(dg) : null,
      defaultGroupName: dg?.name || null,
      showHolidays: (settings as any).showHolidays !== false,
    };
  }

  async update(
    defaultGroupId: string | null | undefined,
    showHolidays?: boolean,
  ): Promise<SettingsDto> {
    const $set: Record<string, unknown> = { defaultGroupId: defaultGroupId || null };
    if (showHolidays !== undefined) $set.showHolidays = showHolidays;
    const settings = await AppSettings.findOneAndUpdate(
      { key: 'global' },
      { $set },
      { upsert: true, new: true },
    ).populate('defaultGroupId', 'name');
    const dg = (settings as any).defaultGroupId;
    return {
      defaultGroupId: dg?._id ? String(dg._id) : dg ? String(dg) : null,
      defaultGroupName: dg?.name || null,
      showHolidays: (settings as any).showHolidays !== false,
    };
  }
}
