import { getDb } from '../db/database.ts';
import type { ScheduleRow, SectionRow, StationRow, TrainRow } from '../types.ts';
import { loadScheduleRows } from './verifier.ts';

export interface PropagationNode {
  train_id: number;
  train_no: string;
  name: string;
  category: string;
  added_delay_min: number;
  hop: number;
  cause: string;
  station_code: string;
}

export interface PropagationEdge {
  from_train_id: number;
  to_train_id: number;
  from_train_no: string;
  to_train_no: string;
  link_type: 'HEADWAY' | 'CROSSING' | 'PLATFORM' | 'CONNECTION' | 'RAKE';
  delay_transferred_min: number;
  location: string;
}

export function analyzeDelayPropagation(rootTrainId: number, initialDelayMin = 20, scheduleKind: 'ORIGINAL' | 'OPTIMIZED' = 'ORIGINAL') {
  const db = getDb();
  const rows = loadScheduleRows(scheduleKind);
  const trains = db.prepare('SELECT * FROM trains').all() as unknown as TrainRow[];
  const stations = db.prepare('SELECT * FROM stations').all() as unknown as StationRow[];
  const sections = db.prepare('SELECT * FROM sections').all() as unknown as SectionRow[];
  const connections = db.prepare('SELECT * FROM connections').all() as Array<{
    feeder_train_id: number;
    connecting_train_id: number;
    station_id: number;
    min_transfer_min: number;
  }>;
  const rakes = db.prepare('SELECT * FROM rakes').all() as Array<{ id: number; next_train_id: number | null; turnaround_min: number }>;

  const trainMap = new Map(trains.map((t) => [t.id, t]));
  const stnMap = new Map(stations.map((s) => [s.id, s]));
  const secMap = new Map(sections.map((s) => [s.id, s]));

  const rootTrain = trainMap.get(rootTrainId);
  if (!rootTrain) {
    return { root_train: null, nodes: [], edges: [], total_knock_on_min: 0, affected_count: 0 };
  }

  const byTrain = new Map<number, ScheduleRow[]>();
  for (const r of rows) {
    if (!byTrain.has(r.train_id)) byTrain.set(r.train_id, []);
    byTrain.get(r.train_id)!.push(r);
  }

  const delayByTrain = new Map<number, number>([[rootTrainId, initialDelayMin]]);
  const hopByTrain = new Map<number, number>([[rootTrainId, 0]]);
  const causeByTrain = new Map<number, { cause: string; stn: string }>([[rootTrainId, { cause: 'Initial Delay Shock', stn: stnMap.get(rootTrain.origin_id)?.code ?? '' }]]);
  const edges: PropagationEdge[] = [];
  const queue: number[] = [rootTrainId];
  const visitedEdges = new Set<string>();

  while (queue.length > 0) {
    const curId = queue.shift()!;
    const curDelay = delayByTrain.get(curId) ?? 0;
    const curHop = hopByTrain.get(curId) ?? 0;
    if (curDelay < 2 || curHop >= 4) continue;

    const curTrain = trainMap.get(curId)!;
    const curRows = byTrain.get(curId) ?? [];

    for (const r of curRows) {
      // 1. Section headway & single-line crossing ripple
      if (r.section_id && r.entry_time !== null && r.exit_time !== null) {
        const sec = secMap.get(r.section_id);
        const newExit = r.exit_time + curDelay;
        for (const other of rows) {
          if (other.train_id === curId || other.section_id !== r.section_id || other.entry_time === null) continue;
          const otherTrain = trainMap.get(other.train_id);
          if (!otherTrain) continue;

          if (sec?.track_type === 'SINGLE' && otherTrain.direction !== curTrain.direction) {
            if (other.entry_time >= r.entry_time && other.entry_time < newExit + 2) {
              const ripple = Math.max(0, newExit + 2 - other.entry_time);
              if (ripple >= 2) {
                const edgeKey = `${curId}->${other.train_id}:CROSSING`;
                if (!visitedEdges.has(edgeKey)) {
                  visitedEdges.add(edgeKey);
                  edges.push({
                    from_train_id: curId,
                    to_train_id: other.train_id,
                    from_train_no: curTrain.train_no,
                    to_train_no: otherTrain.train_no,
                    link_type: 'CROSSING',
                    delay_transferred_min: Math.round(ripple),
                    location: sec.code,
                  });
                }
                if (ripple > (delayByTrain.get(other.train_id) ?? 0)) {
                  delayByTrain.set(other.train_id, Math.round(ripple));
                  hopByTrain.set(other.train_id, curHop + 1);
                  causeByTrain.set(other.train_id, { cause: `Single-line meet wait behind ${curTrain.train_no}`, stn: sec.code });
                  queue.push(other.train_id);
                }
              }
            }
          } else if (otherTrain.direction === curTrain.direction && other.entry_time >= r.entry_time) {
            const newEntry = r.entry_time + curDelay;
            const reqHw = sec?.headway_min ?? 5;
            if (other.entry_time < newEntry + reqHw) {
              const ripple = Math.round(newEntry + reqHw - other.entry_time);
              if (ripple >= 2) {
                const edgeKey = `${curId}->${other.train_id}:HEADWAY`;
                if (!visitedEdges.has(edgeKey)) {
                  visitedEdges.add(edgeKey);
                  edges.push({
                    from_train_id: curId,
                    to_train_id: other.train_id,
                    from_train_no: curTrain.train_no,
                    to_train_no: otherTrain.train_no,
                    link_type: 'HEADWAY',
                    delay_transferred_min: ripple,
                    location: sec?.code ?? 'Section',
                  });
                }
                if (ripple > (delayByTrain.get(other.train_id) ?? 0)) {
                  delayByTrain.set(other.train_id, ripple);
                  hopByTrain.set(other.train_id, curHop + 1);
                  causeByTrain.set(other.train_id, { cause: `Headway queue behind ${curTrain.train_no}`, stn: sec?.code ?? '' });
                  queue.push(other.train_id);
                }
              }
            }
          }
        }
      }

      // 2. Platform ripple
      if (r.platform_id) {
        const newDep = r.departure + curDelay;
        for (const other of rows) {
          if (other.train_id === curId || other.platform_id !== r.platform_id) continue;
          if (other.arrival >= r.arrival && other.arrival < newDep) {
            const ripple = Math.round(newDep - other.arrival);
            const otherTrain = trainMap.get(other.train_id);
            if (ripple >= 2 && otherTrain) {
              const stnCode = stnMap.get(r.station_id)?.code ?? 'Station';
              const edgeKey = `${curId}->${other.train_id}:PLATFORM`;
              if (!visitedEdges.has(edgeKey)) {
                visitedEdges.add(edgeKey);
                edges.push({
                  from_train_id: curId,
                  to_train_id: other.train_id,
                  from_train_no: curTrain.train_no,
                  to_train_no: otherTrain.train_no,
                  link_type: 'PLATFORM',
                  delay_transferred_min: ripple,
                  location: stnCode,
                });
              }
              if (ripple > (delayByTrain.get(other.train_id) ?? 0)) {
                delayByTrain.set(other.train_id, ripple);
                hopByTrain.set(other.train_id, curHop + 1);
                causeByTrain.set(other.train_id, { cause: `Platform occupied by ${curTrain.train_no}`, stn: stnCode });
                queue.push(other.train_id);
              }
            }
          }
        }
      }
    }

    // 3. Passenger connection ripple
    for (const c of connections) {
      if (c.feeder_train_id === curId) {
        const ripple = Math.min(10, Math.round(curDelay * 0.6));
        const otherTrain = trainMap.get(c.connecting_train_id);
        if (ripple >= 2 && otherTrain) {
          const stnCode = stnMap.get(c.station_id)?.code ?? 'Jn';
          const edgeKey = `${curId}->${otherTrain.id}:CONNECTION`;
          if (!visitedEdges.has(edgeKey)) {
            visitedEdges.add(edgeKey);
            edges.push({
              from_train_id: curId,
              to_train_id: otherTrain.id,
              from_train_no: curTrain.train_no,
              to_train_no: otherTrain.train_no,
              link_type: 'CONNECTION',
              delay_transferred_min: ripple,
              location: stnCode,
            });
          }
          if (ripple > (delayByTrain.get(otherTrain.id) ?? 0)) {
            delayByTrain.set(otherTrain.id, ripple);
            hopByTrain.set(otherTrain.id, curHop + 1);
            causeByTrain.set(otherTrain.id, { cause: `Connection hold for ${curTrain.train_no}`, stn: stnCode });
            queue.push(otherTrain.id);
          }
        }
      }
    }

    // 4. Rake turnaround ripple
    if (curTrain.rake_id) {
      const rake = rakes.find((rk) => rk.id === curTrain.rake_id);
      if (rake && rake.next_train_id && rake.next_train_id !== curId) {
        const ripple = Math.round(curDelay * 0.8);
        const otherTrain = trainMap.get(rake.next_train_id);
        if (ripple >= 2 && otherTrain) {
          const edgeKey = `${curId}->${otherTrain.id}:RAKE`;
          if (!visitedEdges.has(edgeKey)) {
            visitedEdges.add(edgeKey);
            edges.push({
              from_train_id: curId,
              to_train_id: otherTrain.id,
              from_train_no: curTrain.train_no,
              to_train_no: otherTrain.train_no,
              link_type: 'RAKE',
              delay_transferred_min: ripple,
              location: 'Turnaround',
            });
          }
          if (ripple > (delayByTrain.get(otherTrain.id) ?? 0)) {
            delayByTrain.set(otherTrain.id, ripple);
            hopByTrain.set(otherTrain.id, curHop + 1);
            causeByTrain.set(otherTrain.id, { cause: `Late rake link from ${curTrain.train_no}`, stn: 'Turnaround' });
            queue.push(otherTrain.id);
          }
        }
      }
    }
  }

  const nodes: PropagationNode[] = [];
  let totalKnockOn = 0;
  for (const [tid, dly] of delayByTrain.entries()) {
    const tr = trainMap.get(tid);
    if (!tr) continue;
    const hop = hopByTrain.get(tid) ?? 0;
    if (hop > 0) totalKnockOn += dly;
    const c = causeByTrain.get(tid);
    nodes.push({
      train_id: tid,
      train_no: tr.train_no,
      name: tr.name,
      category: tr.category,
      added_delay_min: dly,
      hop,
      cause: c?.cause ?? '',
      station_code: c?.stn ?? '',
    });
  }
  nodes.sort((a, b) => a.hop - b.hop || b.added_delay_min - a.added_delay_min);

  return {
    root_train: { id: rootTrain.id, train_no: rootTrain.train_no, name: rootTrain.name, category: rootTrain.category },
    nodes,
    edges,
    total_knock_on_min: totalKnockOn,
    affected_count: Math.max(0, nodes.length - 1),
  };
}
