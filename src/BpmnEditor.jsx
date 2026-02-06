import React, { useEffect, useRef, useState } from 'react';
import BpmnModeler from 'bpmn-js/lib/Modeler';

import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn.css';

export default function BpmnEditor() {
    const containerRef = useRef(null);
    const modelerRef = useRef(null);
    const [inputData, setInputData] = useState('');

    useEffect(() => {
        modelerRef.current = new BpmnModeler({
            container: containerRef.current,
            keyboard: { bindTo: window }
        });
        return () => modelerRef.current.destroy();
    }, []);

    const getNodeSize = (type) => {
        if (type === 'start' || type === 'end') return { w: 36, h: 36 };
        if (type === 'gateway') return { w: 50, h: 50 };
        return { w: 120, h: 80 };
    };

    const convertJsonToXmlWithDI = (jsonString) => {
        try {
            const cleanJson = jsonString.replace(/```json|```/g, '').trim();
            const data = JSON.parse(cleanJson);

            const nodes = data.nodes || [];
            const edges = data.edges || [];
            const pools = data.pools || [];
            const messageFlows = data.messageFlows || [];

            let participantsXml = '';
            let processesXml = '';
            let diPoolsLanes = '';
            let diNodes = '';
            let diEdges = '';

            const POOL_X = 160;
            const NODE_X_OFFSET = 120;
            const maxNodeX = Math.max(...nodes.map(n => n.x || 0), 1000);
            const POOL_WIDTH = maxNodeX + 400;
            const LANE_HEIGHT = 200;
            const POOL_GAP = 120;

            let currentPoolY = 50;
            let finalNodeCoords = {};

            // 1. DUYỆT POOLS
            pools.forEach((p, pIdx) => {
                const laneCount = p.lanes?.length || 1;
                const poolHeight = laneCount * LANE_HEIGHT;

                // FIX: Tự động sinh Process ID nếu thiếu để tránh chồng lấn layer
                const procId = p.processId || `Process_Auto_${pIdx}`;
                participantsXml += `<bpmn:participant id="${p.id}" name="${p.name}" processRef="${procId}" />`;

                diPoolsLanes += `<bpmndi:BPMNShape id="${p.id}_di" bpmnElement="${p.id}" isHorizontal="true">
                                    <dc:Bounds x="${POOL_X}" y="${currentPoolY}" width="${POOL_WIDTH}" height="${poolHeight}" />
                                 </bpmndi:BPMNShape>`;

                let lanesXml = '';
                let nodeIdsInPool = new Set();

                if (p.lanes && p.lanes.length > 0) {
                    lanesXml = `<bpmn:laneSet id="Set_${p.id}">`;
                    p.lanes.forEach((lane, lIdx) => {
                        const laneY = currentPoolY + (lIdx * LANE_HEIGHT);
                        lanesXml += `<bpmn:lane id="${lane.id}" name="${lane.name}">`;
                        (lane.nodeRefs || []).forEach(ref => {
                            lanesXml += `<bpmn:flowNodeRef>${ref}</bpmn:flowNodeRef>`;
                            nodeIdsInPool.add(ref);

                            const n = nodes.find(node => node.id === ref);
                            if (n) {
                                const s = getNodeSize(n.type);
                                finalNodeCoords[n.id] = {
                                    x: Math.max(n.x || 300, POOL_X + NODE_X_OFFSET),
                                    y: laneY + (LANE_HEIGHT / 2) - (s.h / 2),
                                    w: s.w, h: s.h, type: n.type, laneBottom: laneY + LANE_HEIGHT
                                };
                            }
                        });
                        lanesXml += `</bpmn:lane>`;

                        diPoolsLanes += `<bpmndi:BPMNShape id="${lane.id}_di" bpmnElement="${lane.id}" isHorizontal="true">
                                            <dc:Bounds x="${POOL_X + 30}" y="${laneY}" width="${POOL_WIDTH - 30}" height="${LANE_HEIGHT}" />
                                         </bpmndi:BPMNShape>`;
                    });
                    lanesXml += `</bpmn:laneSet>`;
                } else {
                    // Pool không có lane (Vd: Pool khách hàng cũ)
                    nodes.filter(n => n.processId === p.processId).forEach(n => {
                        nodeIdsInPool.add(n.id);
                        const s = getNodeSize(n.type);
                        finalNodeCoords[n.id] = {
                            x: Math.max(n.x || 300, POOL_X + NODE_X_OFFSET),
                            y: currentPoolY + (poolHeight / 2) - (s.h / 2),
                            w: s.w, h: s.h, type: n.type, laneBottom: currentPoolY + poolHeight
                        };
                    });
                }

                const typeMap = { start: 'bpmn:startEvent', end: 'bpmn:endEvent', gateway: 'bpmn:exclusiveGateway', task: 'bpmn:userTask', subProcess: 'bpmn:subProcess' };
                let nodesInPoolXml = nodes.filter(n => nodeIdsInPool.has(n.id)).map(n => `<${typeMap[n.type] || 'bpmn:task'} id="${n.id}" name="${n.name || ''}" />`).join('');
                let flowsInPoolXml = edges.filter(e => nodeIdsInPool.has(e.from)).map(e => `<bpmn:sequenceFlow id="F_${e.from}_${e.to}" sourceRef="${e.from}" targetRef="${e.to}" name="${e.label || ''}" />`).join('');

                processesXml += `<bpmn:process id="${procId}" isExecutable="true">${lanesXml}${nodesInPoolXml}${flowsInPoolXml}</bpmn:process>`;
                currentPoolY += poolHeight + POOL_GAP;
            });

            // 2. DI SHAPES (NODES)
            Object.keys(finalNodeCoords).forEach(id => {
                const c = finalNodeCoords[id];
                diNodes += `<bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}" isExpanded="false">
                                <dc:Bounds x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" />
                             </bpmndi:BPMNShape>`;
            });

            // 3. DI EDGES (SMART ROUTING)
            edges.forEach((e) => {
                const f = finalNodeCoords[e.from]; const t = finalNodeCoords[e.to];
                if (!f || !t) return;

                if (t.x < f.x) { // LOOP BACK
                    const bypassY = f.laneBottom - 20;
                    diEdges += `<bpmndi:BPMNEdge id="F_${e.from}_${e.to}_di" bpmnElement="F_${e.from}_${e.to}">
                                    <di:waypoint x="${f.x + f.w / 2}" y="${f.y + f.h}" /><di:waypoint x="${f.x + f.w / 2}" y="${bypassY}" />
                                    <di:waypoint x="${t.x + t.w / 2}" y="${bypassY}" /><di:waypoint x="${t.x + t.w / 2}" y="${t.y + t.h}" />
                                </bpmndi:BPMNEdge>`;
                } else if (f.x === t.x) { // SAME COLUMN (Fix lỗi bị đè)
                    diEdges += `<bpmndi:BPMNEdge id="F_${e.from}_${e.to}_di" bpmnElement="F_${e.from}_${e.to}">
                                    <di:waypoint x="${f.x + f.w / 2}" y="${f.y + f.h}" />
                                    <di:waypoint x="${f.x + f.w / 2}" y="${t.y}" />
                                </bpmndi:BPMNEdge>`;
                } else { // FORWARD
                    const sX = f.x + f.w; const sY = f.y + f.h / 2;
                    const eX = t.x; const eY = t.y + t.h / 2;
                    const midX = sX + (eX - sX) / 2;
                    diEdges += `<bpmndi:BPMNEdge id="F_${e.from}_${e.to}_di" bpmnElement="F_${e.from}_${e.to}">
                                    <di:waypoint x="${sX}" y="${sY}" /><di:waypoint x="${midX}" y="${sY}" /><di:waypoint x="${midX}" y="${eY}" /><di:waypoint x="${eX}" y="${eY}" />
                                </bpmndi:BPMNEdge>`;
                }
            });

            // 4. MESSAGE FLOWS
            messageFlows.forEach((m, idx) => {
                const f = finalNodeCoords[m.from]; const t = finalNodeCoords[m.to];
                if (f && t) {
                    participantsXml += `<bpmn:messageFlow id="Msg_${idx}" sourceRef="${m.from}" targetRef="${m.to}" name="${m.label || ''}" />`;
                    diEdges += `<bpmndi:BPMNEdge id="Msg_${idx}_di" bpmnElement="Msg_${idx}">
                                    <di:waypoint x="${f.x + f.w / 2}" y="${f.y + f.h}" /><di:waypoint x="${t.x + t.w / 2}" y="${t.y}" />
                                </bpmndi:BPMNEdge>`;
                }
            });

            return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="C_M">${participantsXml}</bpmn:collaboration>${processesXml}
  <bpmndi:BPMNDiagram id="D_1"><bpmndi:BPMNPlane id="P_1" bpmnElement="C_M">${diPoolsLanes}${diNodes}${diEdges}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;
        } catch (e) { alert("Lỗi JSON!"); return null; }
    };

    const handleRender = async () => {
        const xml = convertJsonToXmlWithDI(inputData);
        if (xml) {
            await modelerRef.current.importXML(xml);
            modelerRef.current.get('canvas').zoom('fit-viewport');
        }
    };

    return (
        <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', background: '#f8f9fa' }}>
            <header style={{ padding: '20px', background: '#1c1e21', display: 'flex', gap: '15px' }}>
                <textarea
                    placeholder="Dán JSON nghiệp vụ..."
                    value={inputData} onChange={(e) => setInputData(e.target.value)}
                    style={{ flex: 1, height: '80px', borderRadius: '4px', padding: '15px', background: '#2d2f33', color: '#fff', border: 'none' }}
                />
                <button onClick={handleRender} style={{ padding: '0 40px', background: '#28a745', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
                    VẼ QUY TRÌNH CHUẨN V10
                </button>
            </header>
            <div ref={containerRef} style={{ flex: 1, width: '100%' }} />
        </div>
    );
}