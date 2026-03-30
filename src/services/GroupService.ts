import { Property } from '../models/Property';
import { Group } from '../models/Group';
import { GroupDto } from '../types/api';

export class GroupService {
  async list(): Promise<GroupDto[]> {
    const counts = await Property.aggregate([
      { $match: { groupId: { $ne: null } } },
      { $group: { _id: '$groupId', count: { $sum: 1 } } },
    ]);
    const countMap = new Map<string, number>(counts.map((c) => [String(c._id), c.count]));
    const groups = await Group.find().lean();
    return groups.map((g: any) => ({
      id: String(g._id),
      name: g.name,
      propertyCount: countMap.get(String(g._id)) || 0,
    }));
  }

  async create(name: string): Promise<{ id: string }> {
    if (!name) throw Object.assign(new Error('Name is required'), { status: 400 });
    const exists = await Group.findOne({ name }).lean();
    if (exists) throw Object.assign(new Error('Group already exists'), { status: 400 });
    const group = await Group.create({ name });
    return { id: String(group._id) };
  }

  async update(id: string, name: string): Promise<boolean> {
    if (!name) throw Object.assign(new Error('Name is required'), { status: 400 });
    await Group.updateOne({ _id: id }, { $set: { name } });
    return true;
  }

  async delete(id: string): Promise<void> {
    const propsCount = await Property.countDocuments({ groupId: id });
    if (propsCount > 0) {
      throw Object.assign(
        new Error('Cannot delete group with assigned properties'),
        { status: 400 },
      );
    }
    await Group.deleteOne({ _id: id });
  }
}
