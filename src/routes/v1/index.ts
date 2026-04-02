import { Router, Request, Response } from 'express';
import { requireAdmin } from '../../middleware/auth';
import { BookingService } from '../../services/BookingService';
import { PropertyService } from '../../services/PropertyService';
import { GroupService } from '../../services/GroupService';
import { MergeService } from '../../services/MergeService';
import { BlockService } from '../../services/BlockService';
import { SettingsService } from '../../services/SettingsService';
import { SummaryService } from '../../services/SummaryService';
import { SyncScheduler } from '../../services/SyncScheduler';
import { ApiResponse, ApiError } from '../../types/api';

const router = Router();

const bookingService = new BookingService();
const propertyService = new PropertyService();
const groupService = new GroupService();
const mergeService = new MergeService();
const blockService = new BlockService();
const settingsService = new SettingsService();
const summaryService = new SummaryService();
const syncScheduler = new SyncScheduler();

// Helper: wrap service calls with consistent error handling
function sendError(res: Response, err: any): void {
  const status = err.status || 500;
  const body: ApiError = {
    error: {
      code:
        status === 400
          ? 'VALIDATION_ERROR'
          : status === 404
            ? 'NOT_FOUND'
            : status === 409
              ? 'CONFLICT'
              : 'INTERNAL_ERROR',
      message: err.message || 'Internal server error',
      details:
        err.conflicts || err.conflictType
          ? { conflicts: err.conflicts, conflictType: err.conflictType }
          : undefined,
    },
  };
  res.status(status).json(body);
}

function ok<T>(res: Response, data: T, meta?: any): void {
  const body: ApiResponse<T> = { data };
  if (meta) body.meta = meta;
  res.json(body);
}

// ── Bookings ─────────────────────────────────────────────────────────────────

router.get('/bookings', async (req: Request, res: Response) => {
  try {
    const params = {
      from: req.query.from as string,
      to: req.query.to as string,
      sortBy: (req.query.sortBy as 'start' | 'end') || undefined,
      filterMode: (req.query.filterMode as 'overlap' | 'sortBy') || undefined,
      groupId: req.query.groupId as string,
      propertyIds: req.query.propertyIds as string,
      includeCancelled: req.query.includeCancelled === 'true',
      page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    };
    const { rows, meta } = await bookingService.list(params);
    ok(res, rows, meta);
  } catch (err: any) {
    sendError(res, err);
  }
});

router.get('/bookings/:id', async (req: Request, res: Response) => {
  try {
    const booking = await bookingService.getById(req.params.id);
    if (!booking)
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Booking not found' } });
    ok(res, booking);
  } catch (err: any) {
    sendError(res, err);
  }
});

router.patch('/bookings/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const updated = await bookingService.patch(req.params.id, req.body);
    if (!updated)
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Booking not found' } });
    ok(res, { success: true });
  } catch (err: any) {
    sendError(res, err);
  }
});

router.delete('/bookings/cancelled', requireAdmin, async (req: Request, res: Response) => {
  try {
    const ids = req.body?.ids as string[] | undefined;
    const deletedCount = await bookingService.deleteCancelled(ids);
    ok(res, { deletedCount });
  } catch (err: any) {
    sendError(res, err);
  }
});

// ── Properties ───────────────────────────────────────────────────────────────

router.get('/properties', async (req: Request, res: Response) => {
  try {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const props = await propertyService.list(baseUrl);
    ok(res, props);
  } catch (err: any) {
    sendError(res, err);
  }
});

router.get('/properties/:id', async (req: Request, res: Response) => {
  try {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const prop = await propertyService.getById(req.params.id, baseUrl);
    if (!prop)
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Property not found' } });
    ok(res, prop);
  } catch (err: any) {
    sendError(res, err);
  }
});

router.post('/properties', requireAdmin, async (req: Request, res: Response) => {
  try {
    const result = await propertyService.create(req.body);
    res.status(201).json({ data: result } as ApiResponse);
  } catch (err: any) {
    sendError(res, err);
  }
});

router.put('/properties/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const updated = await propertyService.update(req.params.id, req.body);
    if (!updated)
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Property not found' } });
    ok(res, { success: true });
  } catch (err: any) {
    sendError(res, err);
  }
});

router.delete('/properties/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    await propertyService.delete(req.params.id);
    res.status(204).end();
  } catch (err: any) {
    sendError(res, err);
  }
});

router.post(
  '/properties/:id/regenerate-token',
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const result = await propertyService.regenerateExportToken(req.params.id, baseUrl);
      ok(res, result);
    } catch (err: any) {
      sendError(res, err);
    }
  },
);

// ── Property Sources ─────────────────────────────────────────────────────────

router.get('/properties/:propertyId/sources', async (req: Request, res: Response) => {
  try {
    const sources = await propertyService.listSources(req.params.propertyId);
    ok(res, sources);
  } catch (err: any) {
    sendError(res, err);
  }
});

router.post(
  '/properties/:propertyId/sources',
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const result = await propertyService.addSource(req.params.propertyId, req.body);
      res.status(201).json({ data: result } as ApiResponse);
    } catch (err: any) {
      sendError(res, err);
    }
  },
);

router.put(
  '/properties/:propertyId/sources/:sourceId',
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const updated = await propertyService.updateSource(
        req.params.propertyId,
        req.params.sourceId,
        req.body,
      );
      if (!updated)
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Source not found' } });
      ok(res, { success: true });
    } catch (err: any) {
      sendError(res, err);
    }
  },
);

router.delete(
  '/properties/:propertyId/sources/:sourceId',
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const deleted = await propertyService.deleteSource(
        req.params.propertyId,
        req.params.sourceId,
      );
      if (!deleted)
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Source not found' } });
      res.status(204).end();
    } catch (err: any) {
      sendError(res, err);
    }
  },
);

// ── Groups ───────────────────────────────────────────────────────────────────

router.get('/groups', async (req: Request, res: Response) => {
  try {
    const groups = await groupService.list();
    ok(res, groups);
  } catch (err: any) {
    sendError(res, err);
  }
});

router.post('/groups', requireAdmin, async (req: Request, res: Response) => {
  try {
    const result = await groupService.create(req.body.name);
    res.status(201).json({ data: result } as ApiResponse);
  } catch (err: any) {
    sendError(res, err);
  }
});

router.put('/groups/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    await groupService.update(req.params.id, req.body.name);
    ok(res, { success: true });
  } catch (err: any) {
    sendError(res, err);
  }
});

router.delete('/groups/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    await groupService.delete(req.params.id);
    res.status(204).end();
  } catch (err: any) {
    sendError(res, err);
  }
});

// ── Merge / Split ────────────────────────────────────────────────────────────

router.post('/merge', requireAdmin, async (req: Request, res: Response) => {
  try {
    const result = await mergeService.merge(req.body.ids);
    res.status(201).json({ data: result } as ApiResponse);
  } catch (err: any) {
    sendError(res, err);
  }
});

router.post('/split', requireAdmin, async (req: Request, res: Response) => {
  try {
    const result = await mergeService.split(req.body.id, req.body.splitDate);
    res.status(201).json({ data: result } as ApiResponse);
  } catch (err: any) {
    sendError(res, err);
  }
});

router.post('/undo-merge', requireAdmin, async (req: Request, res: Response) => {
  try {
    await mergeService.undoMerge(req.body.id);
    ok(res, { success: true });
  } catch (err: any) {
    sendError(res, err);
  }
});

router.post('/undo-split', requireAdmin, async (req: Request, res: Response) => {
  try {
    await mergeService.undoSplit(req.body.id);
    ok(res, { success: true });
  } catch (err: any) {
    sendError(res, err);
  }
});

router.post('/resolve-conflict', requireAdmin, async (req: Request, res: Response) => {
  try {
    await mergeService.resolveConflict(req.body.manualId, req.body.decision);
    ok(res, { success: true });
  } catch (err: any) {
    sendError(res, err);
  }
});

// ── Blocks ───────────────────────────────────────────────────────────────────

router.post('/blocks', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { error } = blockService.validateCreate(req.body);
    if (error)
      return res
        .status(400)
        .json({ error: { code: 'VALIDATION_ERROR', message: error.details[0].message } });
    const result = await blockService.create(req.body);
    res.status(201).json({ data: result } as ApiResponse);
  } catch (err: any) {
    sendError(res, err);
  }
});

router.put('/blocks/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { error } = blockService.validateUpdate(req.body);
    if (error)
      return res
        .status(400)
        .json({ error: { code: 'VALIDATION_ERROR', message: error.details[0].message } });
    await blockService.update(req.params.id, req.body);
    ok(res, { success: true });
  } catch (err: any) {
    sendError(res, err);
  }
});

router.delete('/blocks/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    await blockService.delete(req.params.id);
    res.status(204).end();
  } catch (err: any) {
    sendError(res, err);
  }
});

router.post('/blocks/:id/resolve-conflict', requireAdmin, async (req: Request, res: Response) => {
  try {
    await blockService.resolveConflict(req.params.id);
    ok(res, { success: true });
  } catch (err: any) {
    sendError(res, err);
  }
});

// ── Settings ─────────────────────────────────────────────────────────────────

router.get('/settings', async (req: Request, res: Response) => {
  try {
    const settings = await settingsService.get();
    ok(res, settings);
  } catch (err: any) {
    sendError(res, err);
  }
});

router.put('/settings', requireAdmin, async (req: Request, res: Response) => {
  try {
    const settings = await settingsService.update(req.body.defaultGroupId, req.body.showHolidays);
    ok(res, settings);
  } catch (err: any) {
    sendError(res, err);
  }
});

// ── Summary ──────────────────────────────────────────────────────────────────

router.get('/summary', async (req: Request, res: Response) => {
  try {
    const { from, to } = req.query;
    if (!from || !to)
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'from and to query params required' },
      });
    const data = await summaryService.getForDateRange(from as string, to as string);
    ok(res, data);
  } catch (err: any) {
    sendError(res, err);
  }
});

router.get('/summary/current-month', async (req: Request, res: Response) => {
  try {
    const data = await summaryService.getCurrentMonth();
    ok(res, data);
  } catch (err: any) {
    sendError(res, err);
  }
});

router.get('/summary/next-month', async (req: Request, res: Response) => {
  try {
    const data = await summaryService.getNextMonth();
    ok(res, data);
  } catch (err: any) {
    sendError(res, err);
  }
});

// ── Sync ─────────────────────────────────────────────────────────────────────

router.post('/sync', requireAdmin, async (req: Request, res: Response) => {
  try {
    const startTime = Date.now();
    const stats = await syncScheduler.runSync();
    const duration = Date.now() - startTime;
    ok(res, {
      message: 'Sync completed',
      stats,
      syncId: `manual_${Date.now()}`,
      duration,
    });
  } catch (err: any) {
    sendError(res, err);
  }
});

export default router;
