import React, { useEffect, useRef, useState } from 'react';
import BpmnModeler from 'bpmn-js/lib/Modeler';

import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn.css';

// Tải font Manrope
const fontLink = document.createElement('link');
fontLink.href = 'https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;600;800&display=swap';
fontLink.rel = 'stylesheet';
document.head.appendChild(fontLink);

export default function BpmnEditor() {
    const containerRef = useRef(null);
    const modelerRef = useRef(null);
    const [inputData, setInputData] = useState('');
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [showGuide, setShowGuide] = useState(false);
    const [validation, setValidation] = useState({ errors: [], warnings: [] });

    useEffect(() => {
        modelerRef.current = new BpmnModeler({
            container: containerRef.current,
            keyboard: { bindTo: window }
        });
        const initialXml = `<?xml version="1.0" encoding="UTF-8"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" targetNamespace="http://bpmn.io/schema/bpmn"><bpmn:process id="P_1" isExecutable="false"/><bpmndi:BPMNDiagram id="D_1"><bpmndi:BPMNPlane id="Pl_1" bpmnElement="P_1"/></bpmndi:BPMNDiagram></bpmn:definitions>`;
        modelerRef.current.importXML(initialXml);
        return () => modelerRef.current.destroy();
    }, []);

    useEffect(() => {
        if (modelerRef.current) {
            setTimeout(() => { modelerRef.current.get('canvas').resized(); }, 350);
        }
    }, [isSidebarOpen]);

    const runValidation = (jsonStr) => {
        const errors = [];
        try {
            const clean = jsonStr.replace(/```json|```/g, '').trim();
            if (!clean) return { errors: [], warnings: [] };
            const data = JSON.parse(clean);
            if (!data.nodes) errors.push("Thiếu mảng 'nodes'");
            if (!data.edges) errors.push("Thiếu mảng 'edges'");
            const nodeIds = new Set(data.nodes?.map(n => n.id));
            data.edges?.forEach((e, i) => {
                if (!e.from || !e.to) errors.push(`Cạnh ${i + 1} phải dùng từ khóa 'from' và 'to'`);
                else if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) errors.push(`Cạnh ${i + 1} trỏ tới Node ID không tồn tại`);
            });
        } catch (e) { errors.push("Lỗi cú pháp JSON"); }
        return { errors, warnings: [] };
    };

    useEffect(() => { setValidation(runValidation(inputData)); }, [inputData]);

    const getNodeSize = (type) => {
        if (type === 'start' || type === 'end') return { w: 36, h: 36 };
        if (type === 'gateway') return { w: 50, h: 50 };
        return { w: 120, h: 80 };
    };

    const convertJsonToXmlWithDI = (jsonString) => {
        try {
            const data = JSON.parse(jsonString.replace(/```json|```/g, '').trim());
            const nodes = data.nodes; const edges = data.edges; const pools = data.pools || []; const messageFlows = data.messageFlows || [];
            let participantsXml = ''; let processesXml = ''; let diPoolsLanes = ''; let diNodes = ''; let diEdges = '';
            const POOL_X = 160; const NODE_X_OFFSET = 120;
            const maxNodeX = Math.max(...nodes.map(n => n.x || 0), 1000);
            const POOL_WIDTH = maxNodeX + 400; const LANE_HEIGHT = 200; const POOL_GAP = 120;
            let currentPoolY = 50; let finalNodeCoords = {};

            pools.forEach((p, pIdx) => {
                const laneCount = p.lanes?.length || 1; const poolHeight = laneCount * LANE_HEIGHT;
                const procId = p.processId || `Proc_${pIdx}`;
                participantsXml += `<bpmn:participant id="${p.id}" name="${p.name}" processRef="${procId}" />`;
                diPoolsLanes += `<bpmndi:BPMNShape id="${p.id}_di" bpmnElement="${p.id}" isHorizontal="true"><dc:Bounds x="${POOL_X}" y="${currentPoolY}" width="${POOL_WIDTH}" height="${poolHeight}" /></bpmndi:BPMNShape>`;
                let lanesXml = ''; let nodeIdsInPool = new Set();
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
                                finalNodeCoords[n.id] = { x: Math.max(n.x || 300, POOL_X + NODE_X_OFFSET), y: laneY + (LANE_HEIGHT / 2) - (s.h / 2), w: s.w, h: s.h, laneBottom: laneY + LANE_HEIGHT };
                            }
                        });
                        lanesXml += `</bpmn:lane>`;
                        diPoolsLanes += `<bpmndi:BPMNShape id="${lane.id}_di" bpmnElement="${lane.id}" isHorizontal="true"><dc:Bounds x="${POOL_X + 30}" y="${laneY}" width="${POOL_WIDTH - 30}" height="${LANE_HEIGHT}" /></bpmndi:BPMNShape>`;
                    });
                    lanesXml += `</bpmn:laneSet>`;
                } else {
                    nodes.filter(n => n.processId === p.processId).forEach(n => {
                        nodeIdsInPool.add(n.id); const s = getNodeSize(n.type);
                        finalNodeCoords[n.id] = { x: Math.max(n.x || 300, POOL_X + NODE_X_OFFSET), y: currentPoolY + (poolHeight / 2) - (s.h / 2), w: s.w, h: s.h, laneBottom: currentPoolY + poolHeight };
                    });
                }
                const typeMap = { start: 'bpmn:startEvent', end: 'bpmn:endEvent', gateway: 'bpmn:exclusiveGateway', task: 'bpmn:userTask', subProcess: 'bpmn:subProcess' };
                let xmlN = nodes.filter(n => nodeIdsInPool.has(n.id)).map(n => `<${typeMap[n.type] || 'bpmn:task'} id="${n.id}" name="${n.name || ''}" />`).join('');
                let xmlF = edges.filter(e => nodeIdsInPool.has(e.from)).map(e => `<bpmn:sequenceFlow id="F_${e.from}_${e.to}" sourceRef="${e.from}" targetRef="${e.to}" name="${e.label || ''}" />`).join('');
                processesXml += `<bpmn:process id="${procId}" isExecutable="true">${lanesXml}${xmlN}${xmlF}</bpmn:process>`;
                currentPoolY += poolHeight + POOL_GAP;
            });
            Object.keys(finalNodeCoords).forEach(id => {
                const c = finalNodeCoords[id];
                diNodes += `<bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}" isExpanded="false"><dc:Bounds x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" /></bpmndi:BPMNShape>`;
            });
            edges.forEach((e) => {
                const f = finalNodeCoords[e.from]; const t = finalNodeCoords[e.to];
                if (!f || !t) return;
                if (t.x < f.x) {
                    const byY = f.laneBottom - 20;
                    diEdges += `<bpmndi:BPMNEdge id="F_${e.from}_${e.to}_di" bpmnElement="F_${e.from}_${e.to}"><di:waypoint x="${f.x + f.w / 2}" y="${f.y + f.h}" /><di:waypoint x="${f.x + f.w / 2}" y="${byY}" /><di:waypoint x="${t.x + t.w / 2}" y="${byY}" /><di:waypoint x="${t.x + t.w / 2}" y="${t.y + t.h}" /></bpmndi:BPMNEdge>`;
                } else if (f.x === t.x) {
                    diEdges += `<bpmndi:BPMNEdge id="F_${e.from}_${e.to}_di" bpmnElement="F_${e.from}_${e.to}"><di:waypoint x="${f.x + f.w / 2}" y="${f.y + f.h}" /><di:waypoint x="${f.x + f.w / 2}" y="${t.y}" /></bpmndi:BPMNEdge>`;
                } else {
                    const sX = f.x + f.w; const sY = f.y + f.h / 2; const eX = t.x; const eY = t.y + t.h / 2; const mX = sX + (eX - sX) / 2;
                    diEdges += `<bpmndi:BPMNEdge id="F_${e.from}_${e.to}_di" bpmnElement="F_${e.from}_${e.to}"><di:waypoint x="${sX}" y="${sY}" /><di:waypoint x="${mX}" y="${sY}" /><di:waypoint x="${mX}" y="${eY}" /><di:waypoint x="${eX}" y="${eY}" /></bpmndi:BPMNEdge>`;
                }
            });
            messageFlows.forEach((m, idx) => {
                const f = finalNodeCoords[m.from]; const t = finalNodeCoords[m.to];
                if (f && t) {
                    participantsXml += `<bpmn:messageFlow id="Msg_${idx}" sourceRef="${m.from}" targetRef="${m.to}" name="${m.label || ''}" />`;
                    diEdges += `<bpmndi:BPMNEdge id="Msg_${idx}_di" bpmnElement="Msg_${idx}"><di:waypoint x="${f.x + f.w / 2}" y="${f.y + f.h}" /><di:waypoint x="${t.x + t.w / 2}" y="${t.y}" /></bpmndi:BPMNEdge>`;
                }
            });
            return `<?xml version="1.0" encoding="UTF-8"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" targetNamespace="http://bpmn.io/schema/bpmn"><bpmn:collaboration id="C_M">${participantsXml}</bpmn:collaboration>${processesXml}<bpmndi:BPMNDiagram id="D_1"><bpmndi:BPMNPlane id="P_1" bpmnElement="C_M">${diPoolsLanes}${diNodes}${diEdges}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`;
        } catch (e) { return null; }
    };

    const handleRender = async () => {
        if (validation.errors.length > 0) { alert("Lỗi: " + validation.errors[0]); return; }
        const xml = convertJsonToXmlWithDI(inputData);
        if (xml) {
            await modelerRef.current.importXML(xml);
            modelerRef.current.get('canvas').zoom('fit-viewport');
        }
    };

    return (
        <div style={{ width: '100vw', height: '100vh', display: 'flex', background: '#f8f9fa', overflow: 'hidden', fontFamily: "'Manrope', sans-serif" }}>
            <main style={{ flex: 1, position: 'relative' }}><div ref={containerRef} style={{ width: '100%', height: '100%' }} /></main>

            <aside style={{ width: isSidebarOpen ? '450px' : '30px', height: '100%', background: '#1c1e21', transition: 'all 0.3s ease', display: 'flex', flexDirection: 'column', borderLeft: '1px solid #333', position: 'relative', zIndex: 1000 }}>
                {isSidebarOpen && (
                    <div style={{ padding: '25px', width: '450px', height: '100%', display: 'flex', flexDirection: 'column', gap: '20px', overflowY: 'auto', boxSizing: 'border-box' }}>
                        <h2 style={{ color: '#fff', margin: 0, fontSize: '20px', borderLeft: '4px solid #28a745', paddingLeft: '12px', fontWeight: '800' }}>BPMN STUDIO V16</h2>

                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <label style={{ color: '#aaa', fontSize: '11px', fontWeight: 'bold' }}>NHẬP DỮ LIỆU JSON:</label>
                            <textarea value={inputData} onChange={(e) => setInputData(e.target.value)} placeholder="Dán chuỗi JSON chuẩn tại đây..." style={{ flex: 1, width: '100%', borderRadius: '10px', padding: '15px', background: '#2c3136', color: '#fff', border: validation.errors.length > 0 ? '1px solid #e74c3c' : '1px solid #444', fontSize: '13px', resize: 'none', fontFamily: 'monospace' }} />
                            {validation.errors.length > 0 && <div style={{ color: '#ff7675', fontSize: '11px' }}>🔴 {validation.errors[0]}</div>}
                        </div>

                        <div style={{ display: 'flex', gap: '12px' }}>
                            <button onClick={handleRender} style={{ flex: 2, padding: '16px', background: validation.errors.length > 0 ? '#444' : '#28a745', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '800' }}>VẼ QUY TRÌNH</button>
                            <button onClick={() => setShowGuide(true)} style={{ flex: 1, padding: '16px', background: '#3498db', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600' }}>CÁCH LÀM</button>
                        </div>
                    </div>
                )}
                <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} style={{ position: 'absolute', left: '-25px', top: '50%', transform: 'translateY(-50%)', width: '25px', height: '80px', background: '#1c1e21', border: '1px solid #444', borderRight: 'none', borderRadius: '8px 0 0 8px', cursor: 'pointer', color: '#fff' }}>{isSidebarOpen ? '▶' : '◀'}</button>
            </aside>

            {/* POPUP HƯỚNG DẪN RIÊNG BIỆT */}
            {showGuide && (
                <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.85)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(8px)' }}>
                    <div style={{ width: '700px', background: '#1e272e', borderRadius: '20px', padding: '40px', color: '#fff', boxShadow: '0 20px 50px rgba(0,0,0,0.5)', border: '1px solid #333' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
                            <h2 style={{ margin: 0, color: '#00cec9', fontSize: '24px' }}>� HƯỚNG DẪN SỬ DỤNG STUDIO</h2>
                            <button onClick={() => setShowGuide(false)} style={{ background: 'none', border: 'none', color: '#aaa', fontSize: '30px', cursor: 'pointer' }}>&times;</button>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '25px' }}>
                            <section>
                                <h3 style={{ color: '#fab1a0', fontSize: '16px', marginBottom: '10px' }}>Bước 1: Chuẩn bị Prompt Nghiệp vụ</h3>
                                <p style={{ fontSize: '14px', color: '#bdc3c7', margin: 0, lineHeight: '1.6' }}>
                                    Lấy "Strict Prompt" mẫu bên dưới, thay thế <b>[Mô tả nghiệp vụ]</b> bằng quy trình bạn muốn vẽ.
                                </p>

                                <div style={{ background: '#2c3e50', padding: '15px', borderRadius: '10px', marginTop: '12px', border: '1px dashed #3498db' }}>
                                    <strong style={{ color: '#3498db', fontSize: '12px', display: 'block', marginBottom: '8px' }}>VÍ DỤ CÁCH MÔ TẢ:</strong>
                                    <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '13px', color: '#dfe6e9', listStyleType: 'square' }}>
                                        <li>Quy trình gồm 2 Pool: Khách hàng và Công ty (Công ty có 2 Lane: Sale và Kế toán).</li>
                                        <li>Khách gửi yêu cầu mua hàng. Sale thực hiện kiểm tra kho hàng.</li>
                                        <li>Nếu còn hàng: Sale xuất hóa đơn và giao hàng cho khách.</li>
                                        <li>Nếu hết hàng: Sale thông báo lỗi và <b>quay lại bước trước</b> (Khách sửa yêu cầu).</li>
                                        <li>Kế toán thực hiện thu tiền sau khi Sale giao hàng xong.</li>
                                    </ul>
                                </div>

                                <button onClick={() => navigator.clipboard.writeText("Đóng vai chuyên gia BA. xuất duy nhất JSON BPMN cho nghiệp vụ: [DÁN MÔ TẢ NGHIỆP VỤ CỦA BẠN].\n\nQuy tắc bắt buộc:\n1. Mảng: pools, nodes, edges, messageFlows.\n2. Node keys: id, type, name, x. (type: start, end, gateway, task, subProcess).\n3. Edge keys: from, to, label.\n4. Tọa độ: x tăng dần (+200).\n5. Chỉ trả về JSON nguyên bản sạch.")}
                                    style={{ marginTop: '15px', padding: '12px 20px', background: '#00cec9', color: '#1c1e21', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', width: '100%', fontFamily: "'Manrope', sans-serif" }}>
                                    Copy Script cho AI
                                </button>
                            </section>

                            <section>
                                <h3 style={{ color: '#fab1a0', fontSize: '16px', marginBottom: '10px' }}>Bước 2: Lấy JSON từ AI</h3>
                                <p style={{ fontSize: '14px', color: '#bdc3c7', margin: 0, lineHeight: '1.6' }}>
                                    Dán toàn bộ Prompt trên vào ChatGPT/Claude. Khi AI trả về khối code JSON, hãy copy chuỗi đó và dán vào <b>Phần nhập dữ liệu</b> bên tay phải màn hình Studio.
                                </p>
                            </section>

                            <section>
                                <h3 style={{ color: '#fab1a0', fontSize: '16px', marginBottom: '10px' }}>Bước 3: Hiển thị và Tinh chỉnh</h3>
                                <p style={{ fontSize: '14px', color: '#bdc3c7', margin: 0, lineHeight: '1.6' }}>
                                    Chọn <b>"VẼ QUY TRÌNH"</b>. Khi sơ đồ hiện lên, bạn có thể tự do kéo thả các đường nối (Sequence Flow) hoặc điều chỉnh lại vị trí Node cho đẹp mắt vì hiện tại hệ thống ưu tiên tính chính xác của dữ liệu hơn là tự xắp xếp (Auto Layout).
                                </p>
                            </section>
                        </div>

                        <button onClick={() => setShowGuide(false)} style={{ marginTop: '40px', width: '100%', padding: '15px', background: '#3498db', color: '#fff', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px' }}>BẮT ĐẦU NGAY</button>
                    </div>
                </div>
            )}
        </div>
    );
}