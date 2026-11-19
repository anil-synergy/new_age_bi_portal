// @ts-nocheck
/** Canvas animation from src/assets/load_animation2.html, sized to its host element instead of the window. */
export function startQhseReportAnimation(canvas: HTMLCanvasElement, host: HTMLElement): () => void {
            let frame = 0;
            let stopped = false;
            const ctx = canvas.getContext('2d', { alpha: false });

            // ============================================================================
            // MATHEMATICAL & KINEMATIC CONSTANTS
            // ============================================================================
            const PI = Math.PI;
            const TAU = PI * 2;
            const NUM_LOOPS = 5;          // 5 synchronized shape layers per icon act
            const NUM_POINTS = 64;        // 64 equidistant parametric vertices per loop (zero jitter)
            const NUM_ACTS = 9;           // 9-Act Non-Technical BI Storytelling Sequence
            const NUM_ORBIT_NODES = 8;    // Foreground harmonic satellite particles

            let width = host.clientWidth;
            let height = host.clientHeight;
            let cx = width / 2;
            let cy = height / 2;
            let fgScale = 0.65;

            // Mouse/Touch subtle parallax interaction
            let targetParallaxX = 0;
            let targetParallaxY = 0;
            let parallaxX = 0;
            let parallaxY = 0;

            host.addEventListener('pointermove', (e) => {
                targetParallaxX = ((e.clientX / width) - 0.5) * 28;
                targetParallaxY = ((e.clientY / height) - 0.5) * 28;
            });

            // ============================================================================
            // UTILITY & EASING FUNCTIONS (After Effects Style Velocity Curves)
            // ============================================================================
            const lerp = (a, b, t) => a + (b - a) * t;
            const clamp = (val, min, max) => Math.max(min, Math.min(max, val));

            function easeInOutQuint(t) {
                return t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;
            }

            // Liquid spring-infused morph curve for snappy, fluid transition
            function easeLiquidMorph(t) {
                if (t <= 0) return 0;
                if (t >= 1) return 1;
                const base = easeInOutQuint(t);
                const liquidOvershoot = Math.sin(t * PI) * Math.sin(t * PI * 2) * 0.045;
                return clamp(base + liquidOvershoot, 0, 1);
            }

            function interpolateColor(rgbA, rgbB, t, alpha = 1) {
                const r = Math.round(lerp(rgbA[0], rgbB[0], t));
                const g = Math.round(lerp(rgbA[1], rgbB[1], t));
                const b = Math.round(lerp(rgbA[2], rgbB[2], t));
                return `rgba(${r}, ${g}, ${b}, ${alpha})`;
            }

            // ============================================================================
            // LIVING 3D "DATA UNIVERSE" NEURAL NETWORK BACKGROUND (~60 Nodes + Pulses)
            // ============================================================================
            const bgNodes = [];
            const bgPulses = [];
            const NUM_BG_NODES = 62;

            function initBackgroundUniverse() {
                bgNodes.length = 0;
                for (let i = 0; i < NUM_BG_NODES; i++) {
                    const depth = 0.25 + Math.random() * 0.75; // Z-depth parallax layer
                    bgNodes.push({
                        x: Math.random() * width,
                        y: Math.random() * height,
                        vx: (Math.random() - 0.5) * 22 * depth,
                        vy: (Math.random() - 0.5) * 22 * depth,
                        depth: depth,
                        radius: (1.0 + Math.random() * 1.6) * depth,
                        phase: Math.random() * TAU
                    });
                }
            }

            function renderBackgroundUniverse(dt, elapsed, primaryColor) {
                // Deep dark space canvas fill (#04060D)
                ctx.fillStyle = '#04060D';
                ctx.fillRect(0, 0, width, height);

                // Smoothly damp parallax
                parallaxX = lerp(parallaxX, targetParallaxX, 0.05);
                parallaxY = lerp(parallaxY, targetParallaxY, 0.05);

                // Subtle ambient nebula glow behind center
                const nebulaGrad = ctx.createRadialGradient(cx, cy, 10, cx, cy, Math.max(width, height) * 0.58);
                nebulaGrad.addColorStop(0, interpolateColor(primaryColor, [12, 20, 45], 0.82, 0.20));
                nebulaGrad.addColorStop(0.5, 'rgba(6, 10, 22, 0.12)');
                nebulaGrad.addColorStop(1, 'rgba(4, 6, 13, 0)');
                ctx.fillStyle = nebulaGrad;
                ctx.fillRect(0, 0, width, height);

                // Update node coordinates
                for (let i = 0; i < bgNodes.length; i++) {
                    const n = bgNodes[i];
                    n.x += n.vx * dt;
                    n.y += n.vy * dt;

                    // Wrap seamlessly around screen edges
                    if (n.x < -40) n.x = width + 40;
                    if (n.x > width + 40) n.x = -40;
                    if (n.y < -40) n.y = height + 40;
                    if (n.y > height + 40) n.y = -40;
                }

                // Draw synaptic connections & spawn traveling light packets
                const maxDist = Math.min(width, height) * 0.23;
                const maxDistSq = maxDist * maxDist;

                ctx.lineWidth = 0.85;
                for (let i = 0; i < bgNodes.length; i++) {
                    const n1 = bgNodes[i];
                    const x1 = n1.x + parallaxX * n1.depth;
                    const y1 = n1.y + parallaxY * n1.depth;

                    for (let j = i + 1; j < bgNodes.length; j++) {
                        const n2 = bgNodes[j];
                        const x2 = n2.x + parallaxX * n2.depth;
                        const y2 = n2.y + parallaxY * n2.depth;

                        const dx = x2 - x1;
                        const dy = y2 - y1;
                        const dSq = dx * dx + dy * dy;

                        if (dSq < maxDistSq) {
                            const distFactor = 1 - Math.sqrt(dSq) / maxDist;
                            const lineAlpha = distFactor * 0.15 * ((n1.depth + n2.depth) * 0.5);
                            ctx.strokeStyle = interpolateColor(primaryColor, [120, 175, 255], 0.65, lineAlpha);
                            ctx.beginPath();
                            ctx.moveTo(x1, y1);
                            ctx.lineTo(x2, y2);
                            ctx.stroke();

                            // Occasionally trigger a synaptic data packet pulse along active links
                            if (bgPulses.length < 18 && Math.random() < 0.0009 * distFactor) {
                                bgPulses.push({
                                    n1: n1,
                                    n2: n2,
                                    progress: 0,
                                    speed: 0.75 + Math.random() * 0.85
                                });
                            }
                        }
                    }
                }

                // Render traveling synaptic data pulses along neural connections
                for (let i = bgPulses.length - 1; i >= 0; i--) {
                    const p = bgPulses[i];
                    p.progress += p.speed * dt;
                    if (p.progress >= 1) {
                        bgPulses.splice(i, 1);
                        continue;
                    }

                    const x1 = p.n1.x + parallaxX * p.n1.depth;
                    const y1 = p.n1.y + parallaxY * p.n1.depth;
                    const x2 = p.n2.x + parallaxX * p.n2.depth;
                    const y2 = p.n2.y + parallaxY * p.n2.depth;

                    // Discard if nodes wrapped far apart
                    if (Math.hypot(x2 - x1, y2 - y1) > maxDist * 1.25) {
                        bgPulses.splice(i, 1);
                        continue;
                    }

                    const px = lerp(x1, x2, p.progress);
                    const py = lerp(y1, y2, p.progress);
                    const pulseAlpha = Math.sin(p.progress * PI) * 0.78;

                    ctx.fillStyle = interpolateColor(primaryColor, [255, 255, 255], 0.6, pulseAlpha);
                    ctx.beginPath();
                    ctx.arc(px, py, 1.9, 0, TAU);
                    ctx.fill();
                }

                // Render 3D parallax neural nodes
                for (let i = 0; i < bgNodes.length; i++) {
                    const n = bgNodes[i];
                    const nx = n.x + parallaxX * n.depth;
                    const ny = n.y + parallaxY * n.depth;
                    const twinkle = 0.25 + 0.35 * Math.sin(elapsed * 2.2 + n.phase);

                    ctx.fillStyle = interpolateColor(primaryColor, [185, 225, 255], 0.55, twinkle * n.depth);
                    ctx.beginPath();
                    ctx.arc(nx, ny, n.radius, 0, TAU);
                    ctx.fill();
                }
            }

            // ============================================================================
            // RESPONSIVE CANVAS SCALING (~135px Compact Visual Footprint)
            // ============================================================================
            function resize() {
                const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
                width = host.clientWidth;
                height = host.clientHeight;
                canvas.width = width * dpr;
                canvas.height = height * dpr;
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                cx = width / 2;
                cy = height / 2;

                // Compact, sleek minimal icon scale (~135px footprint)
                const baseResponsive = Math.min(width, height) / 680;
                fgScale = clamp(baseResponsive, 0.48, 0.70);

                if (bgNodes.length === 0) {
                    initBackgroundUniverse();
                }
            }
            const observer = new ResizeObserver(() => resize());
            observer.observe(host);
            resize();

            // ============================================================================
            // PARAMETRIC GEOMETRY SAMPLERS (64-Vertex Normalized Topologies)
            // All shapes start at 12 o'clock (-PI/2) and wind clockwise for 0% twist
            // ============================================================================

            // 1. Sample Closed Polygon by Exact Arc-Length Parameterization
            function sampleClosedPolygon(t, vertices) {
                const n = vertices.length;
                const segLengths = [];
                let totalLen = 0;
                for (let i = 0; i < n; i++) {
                    const a = vertices[i];
                    const b = vertices[(i + 1) % n];
                    const d = Math.hypot(b.x - a.x, b.y - a.y);
                    segLengths.push(d);
                    totalLen += d;
                }
                let target = (((t % 1) + 1) % 1) * totalLen;
                for (let i = 0; i < n; i++) {
                    if (target <= segLengths[i] || i === n - 1) {
                        const a = vertices[i];
                        const b = vertices[(i + 1) % n];
                        const localT = segLengths[i] > 0.0001 ? target / segLengths[i] : 0;
                        return {
                            x: lerp(a.x, b.x, localT),
                            y: lerp(a.y, b.y, localT)
                        };
                    }
                    target -= segLengths[i];
                }
                return { x: vertices[0].x, y: vertices[0].y };
            }

            // 2. Sample Rounded Rectangle Starting at Top-Center (12 o'clock)
            function sampleRoundedRect(t, cxOff, cyOff, w, h, r) {
                const hw = w / 2;
                const hh = h / 2;
                const cr = Math.min(r, hw, hh);
                const pts = [];
                const cornerSteps = 5;

                // Start at top-center (12 o'clock)
                pts.push({ x: cxOff, y: cyOff - hh });

                // Top-right corner
                for (let i = 0; i <= cornerSteps; i++) {
                    const a = -PI / 2 + (i / cornerSteps) * (PI / 2);
                    pts.push({
                        x: cxOff + hw - cr + Math.cos(a) * cr,
                        y: cyOff - hh + cr + Math.sin(a) * cr
                    });
                }
                // Bottom-right corner
                for (let i = 0; i <= cornerSteps; i++) {
                    const a = 0 + (i / cornerSteps) * (PI / 2);
                    pts.push({
                        x: cxOff + hw - cr + Math.cos(a) * cr,
                        y: cyOff + hh - cr + Math.sin(a) * cr
                    });
                }
                // Bottom-left corner
                for (let i = 0; i <= cornerSteps; i++) {
                    const a = PI / 2 + (i / cornerSteps) * (PI / 2);
                    pts.push({
                        x: cxOff - hw + cr + Math.cos(a) * cr,
                        y: cyOff + hh - cr + Math.sin(a) * cr
                    });
                }
                // Top-left corner
                for (let i = 0; i <= cornerSteps; i++) {
                    const a = PI + (i / cornerSteps) * (PI / 2);
                    pts.push({
                        x: cxOff - hw + cr + Math.cos(a) * cr,
                        y: cyOff - hh + cr + Math.sin(a) * cr
                    });
                }

                return sampleClosedPolygon(t, pts);
            }

            // 3. Sample Thick Capsule / Polyline Stroke as Closed Loop
            function sampleThickPolyline(t, spinePoints, thickness) {
                const leftSide = [];
                const rightSide = [];
                const n = spinePoints.length;

                for (let i = 0; i < n; i++) {
                    const curr = spinePoints[i];
                    let dx = 0, dy = 0;
                    if (i < n - 1) {
                        dx += spinePoints[i + 1].x - curr.x;
                        dy += spinePoints[i + 1].y - curr.y;
                    }
                    if (i > 0) {
                        dx += curr.x - spinePoints[i - 1].x;
                        dy += curr.y - spinePoints[i - 1].y;
                    }
                    const len = Math.hypot(dx, dy) || 1;
                    const nx = -dy / len;
                    const ny = dx / len;
                    leftSide.push({ x: curr.x + nx * thickness, y: curr.y + ny * thickness });
                    rightSide.unshift({ x: curr.x - nx * thickness, y: curr.y - ny * thickness });
                }

                const poly = leftSide.concat(rightSide);
                return sampleClosedPolygon(t, poly);
            }

            // 4. Sample Polar / Starburst / Circle / Tilted Orbit Shape
            function samplePolarShape(t, x, y, rx, ry, lobes = 0, lobeAmp = 0, rotation = 0) {
                const ang = -PI / 2 + t * TAU;
                const mod = lobes > 0 ? 1 + Math.cos(ang * lobes) * lobeAmp : 1;
                const lx = Math.cos(ang) * rx * mod;
                const ly = Math.sin(ang) * ry * mod;
                const cosR = Math.cos(rotation);
                const sinR = Math.sin(rotation);
                return {
                    x: x + (lx * cosR - ly * sinR),
                    y: y + (lx * sinR + ly * cosR)
                };
            }

            // 5. Sample Mechanical Precision Gear / Cogwheel (Act 3: ETL Heavy Lifting)
            function samplePrecisionGear(t, cxOff, cyOff, baseR, toothDepth, numTeeth, rotation = 0) {
                const ang = -PI / 2 + t * TAU;
                const rawWave = Math.cos((ang + rotation) * numTeeth);
                const squareTooth = clamp(rawWave * 2.4, -1, 1);
                const r = baseR + squareTooth * toothDepth;
                return {
                    x: cxOff + Math.cos(ang) * r,
                    y: cyOff + Math.sin(ang) * r
                };
            }

            // 6. Sample Classic Glowing Lightbulb Silhouette (Act 7: Brain & Insight)
            function sampleLightbulbEnvelope(t) {
                const pts = [
                    { x: 0, y: -62 },
                    { x: 24, y: -58 },
                    { x: 42, y: -42 },
                    { x: 46, y: -18 },
                    { x: 38, y: 2 },
                    { x: 22, y: 18 },
                    { x: 18, y: 32 },
                    { x: -18, y: 32 },
                    { x: -22, y: 18 },
                    { x: -38, y: 2 },
                    { x: -46, y: -18 },
                    { x: -42, y: -42 },
                    { x: -24, y: -58 }
                ];
                return sampleClosedPolygon(t, pts);
            }

            // 7. Sample Pie / Donut Sector (Act 8: Visuals & Charts)
            function sampleDonutSector(t, cxOff, cyOff, rInner, rOuter, startAng, endAng) {
                const pts = [];
                const steps = 16;
                for (let i = 0; i <= steps; i++) {
                    const a = lerp(startAng, endAng, i / steps);
                    pts.push({ x: cxOff + Math.cos(a) * rOuter, y: cyOff + Math.sin(a) * rOuter });
                }
                for (let i = steps; i >= 0; i--) {
                    const a = lerp(startAng, endAng, i / steps);
                    pts.push({ x: cxOff + Math.cos(a) * rInner, y: cyOff + Math.sin(a) * rInner });
                }
                return sampleClosedPolygon(t, pts);
            }

            // ============================================================================
            // VIBRANT NEON COLOR PALETTES FOR THE 9 BI STORYTELLING ACTS
            // ============================================================================
            const ACT_PALETTES = [
                // Act 1: DATA COLLECTION (3D Isometric Data Cube — Electric Cyan & Azure)
                { primary: [0, 245, 255], secondary: [56, 189, 248] },
                // Act 2: AI SPARK & AUTOMATION (Magic Wand & Starbursts — Violet & Cyan)
                { primary: [192, 132, 252], secondary: [0, 240, 255] },
                // Act 3: ETL / HEAVY PROCESSING (Interlocking Precision Gears — Aqua Mint & Sky)
                { primary: [45, 212, 191], secondary: [14, 165, 233] },
                // Act 4: FILTERING & TUNING (Equalizer Control Sliders — Emerald Neon & Cyan)
                { primary: [16, 245, 150], secondary: [0, 225, 255] },
                // Act 5: CODING & ENGINEERING (Laptop Screen + `< / >` — Electric Indigo & Cyan)
                { primary: [129, 140, 248], secondary: [0, 245, 255] },
                // Act 6: FORMULAS & NUMBER CRUNCHING (Calculator Grid — Warm Amber & Coral)
                { primary: [251, 191, 36], secondary: [244, 114, 182] },
                // Act 7: BRAIN & INSIGHT (Glowing Lightbulb + Neural Core — Magenta & Gold)
                { primary: [236, 72, 153], secondary: [250, 204, 21] },
                // Act 8: VISUALS & CHARTS (Exploded Donut Chart + Trendline — Turquoise & Sky)
                { primary: [0, 245, 212], secondary: [56, 189, 248] },
                // Act 9: VERIFIED EXECUTIVE REPORT (Clipboard Document + Checkmark — Ice Blue & Emerald)
                { primary: [56, 189, 248], secondary: [52, 211, 153] }
            ];

            // ============================================================================
            // 9-ACT NON-TECHNICAL STORYTELLING ICON RIG (5 Loops Per Act)
            // ============================================================================
            function evaluateActShape(actIndex, loopIdx, t, time) {
                switch (actIndex) {
                    // ----------------------------------------------------------------
                    // ACT 0: DATA COLLECTION (3D Isometric Data Cube + Floating Nodes)
                    // ----------------------------------------------------------------
                    case 0: {
                        const hover = Math.sin(time * 3.4) * 2.5;
                        if (loopIdx === 0) {
                            // Top Isometric Diamond Face
                            return sampleClosedPolygon(t, [
                                { x: 0, y: -58 + hover },
                                { x: 52, y: -28 + hover },
                                { x: 0, y: 2 + hover },
                                { x: -52, y: -28 + hover }
                            ]);
                        }
                        if (loopIdx === 1) {
                            // Left Isometric Cube Face
                            return sampleClosedPolygon(t, [
                                { x: -52, y: -28 + hover },
                                { x: 0, y: 2 + hover },
                                { x: 0, y: 60 + hover },
                                { x: -52, y: 30 + hover }
                            ]);
                        }
                        if (loopIdx === 2) {
                            // Right Isometric Cube Face
                            return sampleClosedPolygon(t, [
                                { x: 0, y: 2 + hover },
                                { x: 52, y: -28 + hover },
                                { x: 52, y: 30 + hover },
                                { x: 0, y: 60 + hover }
                            ]);
                        }
                        const pull = Math.sin(time * 4.2) * 4.5;
                        if (loopIdx === 3) return samplePolarShape(t, -66 + pull, -46 + pull * 0.5, 5.5, 5.5);
                        return samplePolarShape(t, 66 - pull, -46 + pull * 0.5, 5.5, 5.5);
                    }

                    // ----------------------------------------------------------------
                    // ACT 1: AI SPARK (Sleek Magic Wand + Radiant 4-Point AI Starbursts)
                    // ----------------------------------------------------------------
                    case 1: {
                        const pulse = 1 + Math.sin(time * 5.5) * 0.11;
                        if (loopIdx === 0) {
                            // Hero 4-Point AI Starburst at Wand Tip
                            return samplePolarShape(t, 26, -26, 28 * pulse, 28 * pulse, 4, 0.46, 0);
                        }
                        if (loopIdx === 1) {
                            // Diagonal Magic Wand Shaft
                            return sampleThickPolyline(t, [
                                { x: -58, y: 58 },
                                { x: 2, y: -2 }
                            ], 4.8);
                        }
                        if (loopIdx === 2) {
                            // Secondary AI Sparkle Star (Top-Left)
                            return samplePolarShape(t, -30, -44, 13 / pulse, 13 / pulse, 4, 0.44, 0);
                        }
                        if (loopIdx === 3) {
                            // Tertiary AI Sparkle Star (Bottom-Right)
                            return samplePolarShape(t, 52, 24, 11 * pulse, 11 * pulse, 4, 0.44, 0);
                        }
                        // Orbiting Energy Halo Ring around Wand Tip
                        return samplePolarShape(t, 26, -26, 48, 20, 0, 0, -PI / 4 + time * 0.6);
                    }

                    // ----------------------------------------------------------------
                    // ACT 2: ETL / HEAVY PROCESSING (Two Interlocking Cogwheels Turning)
                    // ----------------------------------------------------------------
                    case 2: {
                        const rotSpeed = time * 1.25;
                        if (loopIdx === 0) {
                            // Primary Large 8-Tooth Precision Gear (Top-Left)
                            return samplePrecisionGear(t, -22, -16, 34, 6.5, 8, rotSpeed);
                        }
                        if (loopIdx === 1) {
                            // Secondary Interlocking 6-Tooth Gear (Bottom-Right, counter-rotating)
                            return samplePrecisionGear(t, 30, 26, 24, 5.5, 6, -rotSpeed * (8 / 6) + 0.35);
                        }
                        if (loopIdx === 2) {
                            // Primary Gear Inner Axle Hub
                            return samplePolarShape(t, -22, -16, 12, 12);
                        }
                        if (loopIdx === 3) {
                            // Secondary Gear Inner Axle Hub
                            return samplePolarShape(t, 30, 26, 8.5, 8.5);
                        }
                        // Outer Workflow Sync Halo
                        return samplePolarShape(t, 2, 4, 76, 76, 0, 0, time * 0.25);
                    }

                    // ----------------------------------------------------------------
                    // ACT 3: FILTERING & TUNING (3 Equalizer Sliders + Animated Knobs)
                    // ----------------------------------------------------------------
                    case 3: {
                        const k1 = -22 + Math.sin(time * 3.6) * 19;
                        const k2 = 24 + Math.cos(time * 3.2) * 17;
                        const k3 = -8 + Math.sin(time * 4.0 + 1.2) * 21;

                        if (loopIdx === 0) {
                            // Slider Control Knob 1 (Top Track)
                            return samplePolarShape(t, k1, -38, 11, 11);
                        }
                        if (loopIdx === 1) {
                            // Slider Control Knob 2 (Middle Track)
                            return samplePolarShape(t, k2, 0, 11, 11);
                        }
                        if (loopIdx === 2) {
                            // Slider Control Knob 3 (Bottom Track)
                            return samplePolarShape(t, k3, 38, 11, 11);
                        }
                        if (loopIdx === 3) {
                            // Top Horizontal Filter Track Bar
                            return sampleRoundedRect(t, 0, -38, 124, 6, 3);
                        }
                        // Bottom Horizontal Filter Track Bar
                        return sampleRoundedRect(t, 0, 38, 124, 6, 3);
                    }

                    // ----------------------------------------------------------------
                    // ACT 4: CODING & ENGINEERING (Laptop Screen + Base + `< / >` Code)
                    // ----------------------------------------------------------------
                    case 4: {
                        if (loopIdx === 0) {
                            // Sleek Laptop Display Screen Bezel
                            return sampleRoundedRect(t, 0, -10, 122, 82, 10);
                        }
                        if (loopIdx === 1) {
                            // Laptop Keyboard Deck Base
                            return sampleRoundedRect(t, 0, 42, 148, 12, 6);
                        }
                        if (loopIdx === 2) {
                            // Left Code Bracket `<` inside Laptop Screen
                            return sampleThickPolyline(t, [
                                { x: -18, y: -28 },
                                { x: -38, y: -10 },
                                { x: -18, y: 8 }
                            ], 3.4);
                        }
                        if (loopIdx === 3) {
                            // Right Code Bracket `>` inside Laptop Screen
                            return sampleThickPolyline(t, [
                                { x: 18, y: -28 },
                                { x: 38, y: -10 },
                                { x: 18, y: 8 }
                            ], 3.4);
                        }
                        // Center Forward Slash `/` inside Laptop Screen
                        return sampleThickPolyline(t, [
                            { x: 7, y: -32 },
                            { x: -7, y: 12 }
                        ], 3.0);
                    }

                    // ----------------------------------------------------------------
                    // ACT 5: FORMULAS & NUMBER CRUNCHING (Calculator + Display + Keys)
                    // ----------------------------------------------------------------
                    case 5: {
                        if (loopIdx === 0) {
                            // Rounded Calculator Chassis
                            return sampleRoundedRect(t, 0, 0, 104, 132, 16);
                        }
                        if (loopIdx === 1) {
                            // Top Digital Formula Readout Screen
                            return sampleRoundedRect(t, 0, -36, 76, 26, 6);
                        }
                        if (loopIdx === 2) {
                            // Top-Left Operator Key Card (`+`)
                            return sampleRoundedRect(t, -20, 6, 28, 24, 6);
                        }
                        if (loopIdx === 3) {
                            // Top-Right Operator Key Card (`-`)
                            return sampleRoundedRect(t, 20, 6, 28, 24, 6);
                        }
                        // Bottom Full-Width Equals `=` Key Card
                        return sampleRoundedRect(t, 0, 40, 68, 22, 6);
                    }

                    // ----------------------------------------------------------------
                    // ACT 6: BRAIN & INSIGHT (Glowing Idea Lightbulb + Neural Filament)
                    // ----------------------------------------------------------------
                    case 6: {
                        const glowPulse = 1 + Math.sin(time * 4.8) * 0.07;
                        if (loopIdx === 0) {
                            // Sculpted Glass Lightbulb Envelope
                            return sampleLightbulbEnvelope(t);
                        }
                        if (loopIdx === 1) {
                            // Glowing Brain / Neural Filament Core inside Bulb
                            return samplePolarShape(t, 0, -22, 18 * glowPulse, 18 * glowPulse, 6, 0.26, time * 0.45);
                        }
                        if (loopIdx === 2) {
                            // Screw Thread Base Tier 1
                            return sampleRoundedRect(t, 0, 44, 34, 9, 4.5);
                        }
                        if (loopIdx === 3) {
                            // Screw Thread Base Tier 2
                            return sampleRoundedRect(t, 0, 57, 24, 8, 4);
                        }
                        // Radiant Insight Halo Ring
                        return samplePolarShape(t, 0, -22, 62, 62, 0, 0, 0);
                    }

                    // ----------------------------------------------------------------
                    // ACT 7: VISUALS & CHARTS (Donut Pie Chart + Exploded Slice + Trend)
                    // ----------------------------------------------------------------
                    case 7: {
                        const waveLift = Math.sin(time * 4.2) * 2.8;
                        if (loopIdx === 0) {
                            // Main 260-Degree Radial Donut Chart
                            return sampleDonutSector(t, -22, -16, 15, 36, 0.25 * PI, 1.72 * PI);
                        }
                        if (loopIdx === 1) {
                            // Exploded Highlight Donut Slice (Popped Out Top-Right)
                            return sampleDonutSector(t, -14, -24, 15, 36, -0.22 * PI, 0.20 * PI);
                        }
                        if (loopIdx === 2) {
                            // Smooth Rising Analytical Trendline across bottom-right
                            const waveSpine = [
                                { x: -62, y: 50 },
                                { x: -28, y: 28 - waveLift },
                                { x: 6, y: 42 + waveLift },
                                { x: 38, y: 8 - waveLift },
                                { x: 64, y: -24 }
                            ];
                            return sampleThickPolyline(t, waveSpine, 3.6);
                        }
                        if (loopIdx === 3) return samplePolarShape(t, 38, 8 - waveLift, 5.5, 5.5);
                        return samplePolarShape(t, 64, -24, 6.5, 6.5);
                    }

                    // ----------------------------------------------------------------
                    // ACT 8: VERIFIED EXECUTIVE REPORT (Clipboard + Checkmark + Bars)
                    // ----------------------------------------------------------------
                    case 8: {
                        const barGrow = Math.sin(time * 4.2) * 2.8;
                        if (loopIdx === 0) {
                            // Polished Executive Report Document Sheet
                            return sampleRoundedRect(t, 0, 4, 114, 136, 14);
                        }
                        if (loopIdx === 1) {
                            // Top Clipboard Header / Verified Seal Pill
                            return sampleRoundedRect(t, 0, -40, 56, 18, 9);
                        }
                        if (loopIdx === 2) {
                            // Report Chart Bar 1 (Left)
                            return sampleRoundedRect(t, -28, 34, 15, 32, 4);
                        }
                        if (loopIdx === 3) {
                            // Report Chart Bar 2 (Center)
                            return sampleRoundedRect(t, 0, 24, 15, 52, 4);
                        }
                        // Report Chart Bar 3 (Right Tallest)
                        return sampleRoundedRect(t, 28, 14 - barGrow * 0.5, 15, 72 + barGrow, 4);
                    }
                }
            }

            // Stroke & Fill Visual Hierarchy per Act
            const ACT_LOOP_STYLES = [
                // Act 1: 3D Data Cube
                [
                    { alpha: 1.0, width: 2.5, fillAlpha: 0.18 },
                    { alpha: 0.95, width: 2.4, fillAlpha: 0.12 },
                    { alpha: 0.95, width: 2.4, fillAlpha: 0.08 },
                    { alpha: 0.95, width: 1.8, fillAlpha: 0.85 },
                    { alpha: 0.95, width: 1.8, fillAlpha: 0.85 }
                ],
                // Act 2: AI Magic Wand & Sparkles
                [
                    { alpha: 1.0, width: 2.6, fillAlpha: 0.28 },
                    { alpha: 0.95, width: 2.3, fillAlpha: 0.65 },
                    { alpha: 0.90, width: 2.0, fillAlpha: 0.35 },
                    { alpha: 0.90, width: 2.0, fillAlpha: 0.35 },
                    { alpha: 0.55, width: 1.5, fillAlpha: 0.0 }
                ],
                // Act 3: Interlocking ETL Gears
                [
                    { alpha: 1.0, width: 2.5, fillAlpha: 0.14 },
                    { alpha: 0.96, width: 2.4, fillAlpha: 0.14 },
                    { alpha: 0.95, width: 2.2, fillAlpha: 0.50 },
                    { alpha: 0.95, width: 2.2, fillAlpha: 0.50 },
                    { alpha: 0.38, width: 1.4, fillAlpha: 0.0 }
                ],
                // Act 4: Filtering & Tuning Sliders
                [
                    { alpha: 1.0, width: 2.5, fillAlpha: 0.85 },
                    { alpha: 1.0, width: 2.5, fillAlpha: 0.85 },
                    { alpha: 1.0, width: 2.5, fillAlpha: 0.85 },
                    { alpha: 0.85, width: 2.0, fillAlpha: 0.25 },
                    { alpha: 0.85, width: 2.0, fillAlpha: 0.25 }
                ],
                // Act 5: Engineering Laptop & Code
                [
                    { alpha: 0.96, width: 2.5, fillAlpha: 0.07 },
                    { alpha: 0.98, width: 2.4, fillAlpha: 0.35 },
                    { alpha: 1.0, width: 2.1, fillAlpha: 0.70 },
                    { alpha: 1.0, width: 2.1, fillAlpha: 0.70 },
                    { alpha: 0.95, width: 2.0, fillAlpha: 0.70 }
                ],
                // Act 6: Calculator & Formulas
                [
                    { alpha: 0.96, width: 2.5, fillAlpha: 0.07 },
                    { alpha: 0.95, width: 2.2, fillAlpha: 0.22 },
                    { alpha: 0.92, width: 2.0, fillAlpha: 0.18 },
                    { alpha: 0.92, width: 2.0, fillAlpha: 0.18 },
                    { alpha: 1.0, width: 2.3, fillAlpha: 0.45 }
                ],
                // Act 7: Lightbulb & Brain Intelligence
                [
                    { alpha: 1.0, width: 2.6, fillAlpha: 0.14 },
                    { alpha: 1.0, width: 2.2, fillAlpha: 0.35 },
                    { alpha: 0.92, width: 2.1, fillAlpha: 0.40 },
                    { alpha: 0.90, width: 2.0, fillAlpha: 0.50 },
                    { alpha: 0.35, width: 1.4, fillAlpha: 0.0 }
                ],
                // Act 8: Visuals & Charts
                [
                    { alpha: 0.95, width: 2.4, fillAlpha: 0.16 },
                    { alpha: 1.0, width: 2.5, fillAlpha: 0.38 },
                    { alpha: 1.0, width: 2.2, fillAlpha: 0.65 },
                    { alpha: 0.95, width: 2.0, fillAlpha: 0.90 },
                    { alpha: 1.0, width: 2.2, fillAlpha: 0.95 }
                ],
                // Act 9: Verified Executive Report
                [
                    { alpha: 0.94, width: 2.5, fillAlpha: 0.07 },
                    { alpha: 0.96, width: 2.2, fillAlpha: 0.28 },
                    { alpha: 0.95, width: 2.2, fillAlpha: 0.28 },
                    { alpha: 0.95, width: 2.2, fillAlpha: 0.35 },
                    { alpha: 1.0, width: 2.4, fillAlpha: 0.48 }
                ]
            ];

            // ============================================================================
            // ACT-SPECIFIC SECONDARY TRIM-PATH DETAILS (Non-Technical Visual Polish)
            // ============================================================================
            function drawActTrimDetails(ctx, actFrom, actTo, morphT, time, primary, secondary) {
                const renderOverlay = (act, vis) => {
                    if (vis <= 0.01) return;
                    ctx.save();
                    ctx.lineCap = 'round';
                    ctx.lineJoin = 'round';

                    if (act === 0) {
                        // Act 1 (Data Cube): Converging dashed stream lines pulling nodes into the cube
                        ctx.strokeStyle = interpolateColor(primary, [255, 255, 255], 0.45, 0.65 * vis);
                        ctx.lineWidth = 1.6 * fgScale;
                        ctx.setLineDash([4 * fgScale, 4 * fgScale]);
                        ctx.lineDashOffset = -time * 36 * fgScale;
                        ctx.beginPath();
                        ctx.moveTo(-62 * fgScale, -44 * fgScale);
                        ctx.lineTo(-28 * fgScale, -22 * fgScale);
                        ctx.moveTo(62 * fgScale, -44 * fgScale);
                        ctx.lineTo(28 * fgScale, -22 * fgScale);
                        ctx.stroke();
                        ctx.setLineDash([]);
                    } else if (act === 2) {
                        // Act 3 (ETL Gears): Dynamic circular workflow sync arcs
                        ctx.strokeStyle = interpolateColor(primary, [255, 255, 255], 0.5, 0.72 * vis);
                        ctx.lineWidth = 1.8 * fgScale;
                        ctx.beginPath();
                        ctx.arc(2 * fgScale, 4 * fgScale, 64 * fgScale, -0.75 * PI + time * 1.3, -0.25 * PI + time * 1.3);
                        ctx.stroke();
                        ctx.beginPath();
                        ctx.arc(2 * fgScale, 4 * fgScale, 64 * fgScale, 0.25 * PI + time * 1.3, 0.75 * PI + time * 1.3);
                        ctx.stroke();
                    } else if (act === 3) {
                        // Act 4 (Filtering Sliders): Middle horizontal slider track bar
                        ctx.strokeStyle = interpolateColor(primary, secondary, 0.4, 0.78 * vis);
                        ctx.lineWidth = 4.5 * fgScale;
                        ctx.beginPath();
                        ctx.moveTo(-60 * fgScale, 0);
                        ctx.lineTo(60 * fgScale, 0);
                        ctx.stroke();
                    } else if (act === 5) {
                        // Act 6 (Calculator): Crisp `+`, `-`, and `=` math symbols inside keys
                        ctx.strokeStyle = interpolateColor([255, 255, 255], primary, 0.25, 0.88 * vis);
                        ctx.lineWidth = 2.2 * fgScale;
                        ctx.beginPath();
                        // Plus `+` in top-left key (-20, 6)
                        ctx.moveTo(-26 * fgScale, 6 * fgScale);
                        ctx.lineTo(-14 * fgScale, 6 * fgScale);
                        ctx.moveTo(-20 * fgScale, 0 * fgScale);
                        ctx.lineTo(-20 * fgScale, 12 * fgScale);
                        // Minus `-` in top-right key (20, 6)
                        ctx.moveTo(14 * fgScale, 6 * fgScale);
                        ctx.lineTo(26 * fgScale, 6 * fgScale);
                        // Equals `=` in bottom wide key (0, 40)
                        ctx.moveTo(-12 * fgScale, 37 * fgScale);
                        ctx.lineTo(12 * fgScale, 37 * fgScale);
                        ctx.moveTo(-12 * fgScale, 43 * fgScale);
                        ctx.lineTo(12 * fgScale, 43 * fgScale);
                        ctx.stroke();
                    } else if (act === 6) {
                        // Act 7 (Insight Lightbulb): Radiant light sparks beaming outward
                        ctx.strokeStyle = interpolateColor([255, 255, 255], secondary, 0.35, 0.78 * vis);
                        ctx.lineWidth = 2.0 * fgScale;
                        const rayAngles = [-PI * 0.82, -PI * 0.65, -PI * 0.5, -PI * 0.35, -PI * 0.18];
                        const rayPulse = Math.sin(time * 5.2) * 3;
                        rayAngles.forEach(ang => {
                            const r1 = (54 + rayPulse) * fgScale;
                            const r2 = (68 + rayPulse) * fgScale;
                            ctx.beginPath();
                            ctx.moveTo(Math.cos(ang) * r1, (-20 + Math.sin(ang) * 54) * fgScale);
                            ctx.lineTo(Math.cos(ang) * r2, (-20 + Math.sin(ang) * 68) * fgScale);
                            ctx.stroke();
                        });
                    } else if (act === 8) {
                        // Act 9 (Executive Report): Crisp Verified Checkmark `✓` inside top header + summary rule
                        ctx.strokeStyle = interpolateColor([255, 255, 255], secondary, 0.2, 0.92 * vis);
                        ctx.lineWidth = 2.4 * fgScale;
                        ctx.beginPath();
                        ctx.moveTo(-8 * fgScale, -40 * fgScale);
                        ctx.lineTo(-2 * fgScale, -34 * fgScale);
                        ctx.lineTo(10 * fgScale, -46 * fgScale);
                        ctx.stroke();

                        ctx.strokeStyle = interpolateColor(primary, [255, 255, 255], 0.4, 0.58 * vis);
                        ctx.lineWidth = 1.8 * fgScale;
                        ctx.beginPath();
                        ctx.moveTo(-36 * fgScale, -16 * fgScale);
                        ctx.lineTo(36 * fgScale, -16 * fgScale);
                        ctx.stroke();
                    }

                    ctx.restore();
                };

                renderOverlay(actFrom, Math.pow(1 - morphT, 2.0));
                if (actTo !== actFrom) {
                    renderOverlay(actTo, Math.pow(morphT, 2.0));
                }
            }

            // ============================================================================
            // FOREGROUND ORBITING HARMONIC SATELLITE NODES (8 Nodes)
            // ============================================================================
            const orbitNodes = Array.from({ length: NUM_ORBIT_NODES }, (_, i) => ({
                angle: (i / NUM_ORBIT_NODES) * TAU,
                baseRadius: 78 + (i % 2) * 16,
                speed: 0.48 + (i % 3) * 0.16,
                size: 1.8 + (i % 2) * 0.9,
                phase: i * 0.9
            }));

            // ============================================================================
            // MASTER 60/120HZ ANIMATION LOOP (1.2x Snappy Speed: 0.85s Hold + 0.65s Morph)
            // ============================================================================
            const ACT_HOLD_DURATION = 0.85;  // Crisp readable hold with active micro-motion
            const ACT_MORPH_DURATION = 0.65; // 1.2x faster liquid-smooth After Effects morph
            const ACT_TOTAL_DURATION = ACT_HOLD_DURATION + ACT_MORPH_DURATION;

            let lastFrameTime = 0;
            let startTime = 0;

            function render(now) {
                if (!startTime) {
                    startTime = now;
                    lastFrameTime = now;
                }
                const dt = Math.min(Math.max(0, (now - lastFrameTime) / 1000), 0.05);
                lastFrameTime = now;
                const elapsed = Math.max(0, (now - startTime) / 1000);

                if (width < 2 || height < 2) resize();
                if (width < 2 || height < 2) {
                    if (!stopped) frame = requestAnimationFrame(render);
                    return;
                }

                // Compute current 9-Act state. A frame timestamp slightly behind
                // performance.now() used to make this index -1 and crash the canvas.
                const span = ACT_TOTAL_DURATION * NUM_ACTS;
                const cycleTime = ((elapsed % span) + span) % span;
                let currentActIndex = Math.floor(cycleTime / ACT_TOTAL_DURATION);
                if (currentActIndex < 0 || currentActIndex >= NUM_ACTS) currentActIndex = 0;
                const nextActIndex = (currentActIndex + 1) % NUM_ACTS;
                const localActTime = cycleTime % ACT_TOTAL_DURATION;

                let rawMorph = 0;
                if (localActTime > ACT_HOLD_DURATION) {
                    rawMorph = (localActTime - ACT_HOLD_DURATION) / ACT_MORPH_DURATION;
                }
                const globalEasedMorph = clamp(easeInOutQuint(rawMorph), 0, 1);
                const morphVelocity = Math.sin(rawMorph * PI);

                // Interpolate vibrant foreground neon palette
                const palA = ACT_PALETTES[currentActIndex];
                const palB = ACT_PALETTES[nextActIndex];
                const currentPrimary = [
                    lerp(palA.primary[0], palB.primary[0], globalEasedMorph),
                    lerp(palA.primary[1], palB.primary[1], globalEasedMorph),
                    lerp(palA.primary[2], palB.primary[2], globalEasedMorph)
                ];
                const currentSecondary = [
                    lerp(palA.secondary[0], palB.secondary[0], globalEasedMorph),
                    lerp(palA.secondary[1], palB.secondary[1], globalEasedMorph),
                    lerp(palA.secondary[2], palB.secondary[2], globalEasedMorph)
                ];

                // 1. RENDER LIVING 3D NEURAL NETWORK DATA UNIVERSE BACKGROUND
                renderBackgroundUniverse(dt, elapsed, currentPrimary);

                // 2. FOREGROUND POP RADIAL VIGNETTE CUSHION & NEON AURA
                ctx.save();
                ctx.translate(cx, cy);

                const haloRadius = 158 * fgScale;
                const popGrad = ctx.createRadialGradient(0, 0, 12 * fgScale, 0, 0, haloRadius);
                popGrad.addColorStop(0, interpolateColor(currentPrimary, currentSecondary, 0.4, 0.22));
                popGrad.addColorStop(0.55, 'rgba(4, 6, 13, 0.65)');
                popGrad.addColorStop(1, 'rgba(4, 6, 13, 0)');
                ctx.fillStyle = popGrad;
                ctx.beginPath();
                ctx.arc(0, 0, haloRadius, 0, TAU);
                ctx.fill();

                // 3. RENDER 8 ORBITING HARMONIC FOREGROUND DATA NODES
                orbitNodes.forEach((node, idx) => {
                    const ang = node.angle + elapsed * node.speed + morphVelocity * 0.55 * (idx % 2 === 0 ? 1 : -1);
                    const rad = node.baseRadius * (1 - morphVelocity * 0.18 + Math.sin(elapsed * 2.6 + node.phase) * 0.06) * fgScale;
                    const nx = Math.cos(ang) * rad;
                    const ny = Math.sin(ang) * rad;
                    const alpha = 0.35 + 0.42 * Math.sin(elapsed * 3.4 + node.phase);

                    ctx.fillStyle = interpolateColor(currentPrimary, [255, 255, 255], 0.35, clamp(alpha, 0.15, 0.88));
                    ctx.shadowColor = interpolateColor(currentPrimary, currentSecondary, 0.5, 0.8);
                    ctx.shadowBlur = 8 * fgScale;
                    ctx.beginPath();
                    ctx.arc(nx, ny, node.size * fgScale, 0, TAU);
                    ctx.fill();
                });
                ctx.shadowBlur = 0;

                // 4. KINEMATIC VELOCITY SQUASH & STRETCH IMPULSE
                const squashX = 1 + Math.sin(rawMorph * TAU) * 0.04;
                const squashY = 1 - Math.sin(rawMorph * TAU) * 0.04;
                ctx.scale(squashX, squashY);

                // 5. EVALUATE & RENDER THE 5 VERTEX-MATCHED PARAMETRIC SPLINES
                for (let loopIdx = 0; loopIdx < NUM_LOOPS; loopIdx++) {
                    const staggerDelay = loopIdx * 0.042;
                    const staggeredRaw = clamp((rawMorph - staggerDelay) / (1 - staggerDelay * 1.4), 0, 1);
                    const loopMorphT = clamp(easeLiquidMorph(staggeredRaw), 0, 1);
                    const styleMorphT = clamp(easeInOutQuint(staggeredRaw), 0, 1);

                    const styleA = ACT_LOOP_STYLES[currentActIndex][loopIdx];
                    const styleB = ACT_LOOP_STYLES[nextActIndex][loopIdx];
                    const alpha = lerp(styleA.alpha, styleB.alpha, styleMorphT);
                    const lineWidth = lerp(styleA.width, styleB.width, styleMorphT) * fgScale * 1.18;
                    const fillAlpha = lerp(styleA.fillAlpha, styleB.fillAlpha, styleMorphT);

                    const swirl = Math.sin(staggeredRaw * PI) * 0.12 * (loopIdx % 2 === 0 ? 1 : -1);
                    const cosS = Math.cos(swirl);
                    const sinS = Math.sin(swirl);

                    const pts = [];
                    for (let p = 0; p < NUM_POINTS; p++) {
                        const t = p / NUM_POINTS;
                        const ptA = evaluateActShape(currentActIndex, loopIdx, t, elapsed);
                        const ptB = evaluateActShape(nextActIndex, loopIdx, t, elapsed);

                        const ix = lerp(ptA.x, ptB.x, loopMorphT);
                        const iy = lerp(ptA.y, ptB.y, loopMorphT);

                        pts.push({
                            x: (ix * cosS - iy * sinS) * fgScale,
                            y: (ix * sinS + iy * cosS) * fgScale
                        });
                    }

                    // Construct Smooth Closed Quadratic Midpoint Spline
                    ctx.beginPath();
                    const startMidX = (pts[NUM_POINTS - 1].x + pts[0].x) * 0.5;
                    const startMidY = (pts[NUM_POINTS - 1].y + pts[0].y) * 0.5;
                    ctx.moveTo(startMidX, startMidY);

                    for (let p = 0; p < NUM_POINTS; p++) {
                        const curr = pts[p];
                        const next = pts[(p + 1) % NUM_POINTS];
                        ctx.quadraticCurveTo(curr.x, curr.y, (curr.x + next.x) * 0.5, (curr.y + next.y) * 0.5);
                    }
                    ctx.closePath();

                    const gradBound = 72 * fgScale;
                    const loopGrad = ctx.createLinearGradient(-gradBound, -gradBound, gradBound, gradBound);
                    const blend = loopIdx / (NUM_LOOPS - 1);
                    loopGrad.addColorStop(0, interpolateColor(currentPrimary, [255, 255, 255], 0.18, alpha));
                    loopGrad.addColorStop(1, interpolateColor(currentSecondary, currentPrimary, blend * 0.5, alpha));

                    if (fillAlpha > 0.005) {
                        ctx.fillStyle = interpolateColor(currentPrimary, currentSecondary, 0.45, fillAlpha * alpha);
                        ctx.fill();
                    }

                    // Multi-stage High-Contrast Neon Bloom + Crisp Specular Core
                    ctx.save();
                    ctx.strokeStyle = loopGrad;
                    ctx.lineWidth = lineWidth;
                    ctx.lineCap = 'round';
                    ctx.lineJoin = 'round';
                    ctx.shadowColor = interpolateColor(currentPrimary, currentSecondary, 0.25, alpha);
                    ctx.shadowBlur = (18 + morphVelocity * 10) * fgScale;
                    ctx.stroke();

                    if (alpha > 0.65) {
                        ctx.shadowBlur = 0;
                        ctx.strokeStyle = interpolateColor([255, 255, 255], currentPrimary, 0.3, alpha * 0.78);
                        ctx.lineWidth = Math.max(0.9, lineWidth * 0.42);
                        ctx.stroke();
                    }
                    ctx.restore();

                    // Traveling Trim-Path Energy Highlight along the Hero Loop
                    if (loopIdx === 0) {
                        ctx.save();
                        const segCount = Math.floor(NUM_POINTS * 0.20);
                        const head = Math.floor((elapsed * 48) % NUM_POINTS);

                        ctx.beginPath();
                        for (let k = 0; k <= segCount; k++) {
                            const idx = (head + k) % NUM_POINTS;
                            const nextIdx = (idx + 1) % NUM_POINTS;
                            const c = pts[idx];
                            const n = pts[nextIdx];
                            if (k === 0) ctx.moveTo(c.x, c.y);
                            else ctx.quadraticCurveTo(c.x, c.y, (c.x + n.x) * 0.5, (c.y + n.y) * 0.5);
                        }
                        ctx.strokeStyle = `rgba(255, 255, 255, ${0.92 * alpha})`;
                        ctx.lineWidth = lineWidth * 1.15;
                        ctx.lineCap = 'round';
                        ctx.shadowColor = '#ffffff';
                        ctx.shadowBlur = 12 * fgScale;
                        ctx.stroke();
                        ctx.restore();
                    }
                }

                // 6. RENDER ACT-SPECIFIC INTERNAL TRIM DETAILS
                drawActTrimDetails(ctx, currentActIndex, nextActIndex, globalEasedMorph, elapsed, currentPrimary, currentSecondary);

                ctx.restore();

                if (!stopped) frame = requestAnimationFrame(render);
            }

            frame = requestAnimationFrame(render);
            return () => {
                stopped = true;
                cancelAnimationFrame(frame);
                observer.disconnect();
            };
}
