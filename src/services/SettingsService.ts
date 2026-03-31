import { AppSettings } from '../models/AppSettings';
import { SettingsDto } from '../types/api';

export class SettingsService {
  async get(): Promise<SettingsDto> {
    const settings = await AppSettings.findOne({ key: 'global' })
      .populate('defaultGroupId', 'name')
      .lean();
    if (!settings) return { defaultGroupId: null };
    const dg = (settings as any).defaultGroupId;
    return {
      defaultGroupId: dg?._id ? String(dg._id) : dg ? String(dg) : null,
      defaultGroupName: dg?.name || null,
    };
  }

  async update(defaultGroupId: string | null | undefined): Promise<SettingsDto> {
    const settings = await AppSettings.findOneAndUpdate(
      { key: 'global' },
      { $set: { defaultGroupId: defaultGroupId || null } },
      { upsert: true, new: true },
    ).populate('defaultGroupId', 'name');
    const dg = (settings as any).defaultGroupId;
    return {
      defaultGroupId: dg?._id ? String(dg._id) : dg ? String(dg) : null,
      defaultGroupName: dg?.name || null,
    };
  }
}
