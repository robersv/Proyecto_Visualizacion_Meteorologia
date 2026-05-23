const THEME = {
    bg_main: '#0B132B', bg_card: '#1C2541', text_primary: '#FFFFFF', text_secondary: '#979DAC',
    grid_color: 'rgba(255, 255, 255, 0.08)', colors: { ALTA: '#D62828', MEDIA: '#F7B801', BAJA: '#06D6A0' }
};

const layoutBase = {
    plot_bgcolor: THEME.bg_card, paper_bgcolor: THEME.bg_card,
    font: { color: THEME.text_primary, family: 'Inter, sans-serif' },
    margin: { t: 30, l: 50, r: 20, b: 50 },
    xaxis: { gridcolor: THEME.grid_color, zerolinecolor: THEME.grid_color },
    yaxis: { gridcolor: THEME.grid_color, zerolinecolor: THEME.grid_color },
    legend: { orientation: 'h', y: -0.2 }
};

const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

async function loadData(filename) {
    const res = await fetch(`data/${filename}`);
    if (!res.ok) throw new Error(`Could not load ${filename}`);
    return await res.json();
}

function populateSelect(selectId, options, includeAll = true) {
    const select = document.getElementById(selectId);
    if (!select) return;
    while (select.options.length > (includeAll ? 1 : 0)) select.remove(includeAll ? 1 : 0);
    options.forEach(opt => select.add(new Option(opt, opt)));
}

function dateFilter(data, startId, endId) {
    const start = document.getElementById(startId)?.value;
    const end = document.getElementById(endId)?.value;
    let d = data;
    if (start) d = d.filter(x => x.date >= start);
    if (end) d = d.filter(x => x.date <= end);
    return d;
}

async function initDashboard() {
    try {
        const [
            phenData, windRoseData, visData, cloudData, monthlyData, radarData, gustsData, scatter3dData,
            climateData, hourlyTempData, windDirData, cloud3dData, vis3dData, rvr3dData, tempStackData, macroPhenData
        ] = await Promise.all([
            loadData('phenomena_distribution.json'), loadData('wind_rose.json'), loadData('visibility_vs_traffic.json'),
            loadData('cloud_amounts.json'), loadData('monthly_evolution.json'), loadData('radar_bad_conditions.json'),
            loadData('wind_gusts.json'), loadData('3d_scatter_data.json'),
            loadData('climatological_summary.json'), loadData('hourly_temperature.json'), loadData('wind_direction_freq.json'),
            loadData('cloud_base_3d.json'), loadData('visibility_3d.json'), loadData('rvr_sim_3d.json'),
            loadData('temp_intervals_freq.json'), fetch('data/phenomena_macro_freq.json?v=8').then(r => r.json())
        ]);

        const airports = [...new Set(phenData.map(d => d.airport))].sort();
        const allSelectors = [
            'wind-rose-airport', 'gusts-airport', 'vis-airport', 'clouds-airport', 
            'scatter3d-airport', 'radar-airport', 'climate-airport', 'boxplot-airport',
            'temp-stack-airport', 'wind-dir-airport', 'visor3d-airport', 'evo-airport'
        ];
        
        allSelectors.forEach(id => {
            if(id === 'climate-airport' || id === 'wind-rose-airport') populateSelect(id, airports, false);
            else populateSelect(id, airports);
        });

        // Populate Time Dropdowns
        const timeSelectors = ['gusts-time-start', 'gusts-time-end', 'scatter3d-time-start', 'scatter3d-time-end', 'radar-time-start', 'radar-time-end'];
        timeSelectors.forEach(id => {
            const el = document.getElementById(id);
            if(el) {
                for(let i=0; i<24; i++) {
                    const opt = document.createElement('option');
                    opt.value = i;
                    opt.textContent = i.toString().padStart(2, '0') + ':00';
                    el.appendChild(opt);
                }
                if(id.includes('end')) el.value = 23;
            }
        });

        // Multiselectors
        populateSelect('phenomena-airport', airports, false);
        populateSelect('wind-rose-months', MONTH_NAMES, false);
        populateSelect('phenomena-months', MONTH_NAMES, false);
        populateSelect('evo-months', MONTH_NAMES, false);
        populateSelect('clouds-months', MONTH_NAMES, false);
        populateSelect('macro-phen-airport', airports, false);

        // Pre-select some multiselects
        const phenA = document.getElementById('phenomena-airport');
        if(phenA && phenA.options.length > 0) phenA.options[0].selected = true;
        const wrM = document.getElementById('wind-rose-months');
        if(wrM && wrM.options.length > 0) wrM.options[0].selected = true;
        const phenM = document.getElementById('phenomena-months');
        if(phenM && phenM.options.length > 0) phenM.options[0].selected = true;
        const evoM = document.getElementById('evo-months');
        if(evoM && evoM.options.length > 0) evoM.options[0].selected = true;
        const cloudM = document.getElementById('clouds-months');
        if(cloudM && cloudM.options.length > 0) cloudM.options[0].selected = true;
        const macroA = document.getElementById('macro-phen-airport');
        if(macroA && macroA.options.length > 0) macroA.options[0].selected = true;

        // Init Graphs
        plotPhenomenaDist(phenData);
        setupWindRose(windRoseData);
        setupWindGusts(gustsData);
        setupVisTraffic(visData);
        setupCloudAmounts(cloudData);
        setupMonthlyEvo(monthlyData);
        setupScatter3D(scatter3dData);
        setupRadarCond(radarData);
        setupClimateTable(climateData);
        setupMacroPhen(macroPhenData);
        setupTempBoxplot(hourlyTempData);
        setupTempStack(tempStackData);
        setupWindDir(windDirData);
        setupVisor3D(cloud3dData, vis3dData, rvr3dData);

    } catch (e) { console.error("Dashboard init error:", e); }
}

// 1. Phenomena
function plotPhenomenaDist(data) {
    const selApt = document.getElementById('phenomena-airport');
    const selMonths = document.getElementById('phenomena-months');
    const chkNoInc = document.getElementById('toggle-no-incident');
    const render = () => {
        let d = data;
        if (chkNoInc && !chkNoInc.checked) {
            d = d.filter(x => x.phenomenon !== 'Sin incidentes');
        }
        const selectedApts = Array.from(selApt.selectedOptions).map(opt => opt.value);
        if (selectedApts.length > 0) {
            d = d.filter(x => selectedApts.includes(x.airport));
        }

        const selectedMonths = Array.from(selMonths.selectedOptions).map(opt => opt.value);
        if (selectedMonths.length > 0) {
            d = d.filter(x => {
                if(!x.date) return true; // fallback if data doesn't have date
                const m = parseInt(x.date.split('-')[1]);
                return selectedMonths.includes(MONTH_NAMES[m-1]);
            });
        }

        let total = 0; const agg = {};
        d.forEach(r => { agg[r.phenomenon] = (agg[r.phenomenon] || 0) + Number(r.count); total += Number(r.count); });
        const threshold = total * 0.10;
        const grouped = { 'Otros': 0 };
        const tableData = [];
        for (const [phen, count] of Object.entries(agg)) {
            tableData.push({ phen, count, pct: total > 0 ? (count/total)*100 : 0 });
            if (phen === 'Sin incidentes') {
                grouped[phen] = count;
            } else if (count < threshold) {
                grouped['Otros'] += count;
            } else {
                grouped[phen] = count;
            }
        }
        
        // Remove 'Otros' if it's 0
        if (grouped['Otros'] === 0) delete grouped['Otros'];

        tableData.sort((a,b) => b.count - a.count);
        const tbody = document.querySelector('#phenomena-table tbody');
        tbody.innerHTML = '';
        tableData.forEach(r => {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${r.phen}</td><td>${r.count.toFixed(1)} h</td><td>${r.pct.toFixed(2)}%</td>`;
            tbody.appendChild(tr);
        });
        
        const labels = Object.keys(grouped);
        const values = Object.values(grouped);
        const defaultPalette = ['#48CAE4', '#F7B801', '#D62828', '#8338ec', '#ff006e', '#3a86ff', '#06d6a0'];
        let cIdx = 0;
        const colors = labels.map(l => {
            if (l === 'Sin incidentes') return '#cbd5e1';
            if (l === 'Otros') return '#979DAC';
            return defaultPalette[cIdx++ % defaultPalette.length];
        });

        const trace = { 
            labels: labels, 
            values: values, 
            type: 'pie', 
            hole: 0.4, 
            marker: { colors: colors },
            hovertemplate: '<b>%{label}</b><br>Duración: %{value:.1f} Horas<br>Porcentaje: %{percent}<extra></extra>'
        };
        Plotly.newPlot('phenomena-dist', [trace], { ...layoutBase, margin: {t:10, b:10, l:10, r:10}}, {responsive: true});
    };
    ['phenomena-airport', 'phenomena-months', 'toggle-no-incident'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', render);
    });
    render();
}

// 2. Wind Rose
function setupWindRose(data) {
    const selApt = document.getElementById('wind-rose-airport');
    const selMonths = document.getElementById('wind-rose-months');
    const render = () => {
        let d = data;
        if(selApt.value !== 'Todos') d = d.filter(x => x.airport === selApt.value);
        const selectedMonths = Array.from(selMonths.selectedOptions).map(opt => opt.value);
        if (selectedMonths.length > 0) {
            d = d.filter(x => selectedMonths.includes(x.month_name));
        }
        const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        const speeds = ['0-5', '5-10', '10-15', '15-20', '20+'];
        const colorScale = ['#90E0EF', '#48CAE4', '#00B4D8', '#0077B6', '#03045E'];
        const traces = speeds.map((speed, i) => {
            return {
                r: directions.map(dir => d.filter(x => x.wind_dir_cat === dir && x.wind_speed_cat === speed).reduce((sum, r) => sum + r.count, 0)),
                theta: directions, name: speed + ' kt', type: 'barpolar', marker: { color: colorScale[i] }
            };
        });
        Plotly.newPlot('wind-rose', traces, { ...layoutBase, polar: { angularaxis: { color: THEME.text_secondary }, bgcolor: THEME.bg_card } }, {responsive: true});
    };
    selApt.addEventListener('change', render); selMonths.addEventListener('change', render);
    render();
}

// 3. Gusts Scatter
function setupWindGusts(data) {
    const selApt = document.getElementById('gusts-airport');
    const render = () => {
        let d = dateFilter(data, 'gusts-date-start', 'gusts-date-end');
        if(selApt.value !== 'Todos') d = d.filter(x => x.airport === selApt.value);
        
        const hStart = parseInt(document.getElementById('gusts-time-start').value || "0");
        const hEnd = parseInt(document.getElementById('gusts-time-end').value || "23");
        d = d.filter(x => x.hour >= hStart && x.hour <= hEnd);

        const traces = ['ALTA', 'MEDIA', 'BAJA'].map(lvl => {
            const sub = d.filter(r => r.volume_group === lvl);
            return {
                x: sub.map(r => Number(r.hour)), y: sub.map(r => Number(r.maxKnots)),
                mode: 'markers', type: 'scatter', name: lvl,
                marker: { color: THEME.colors[lvl], size: 6, opacity: 0.6 }
            };
        });
        Plotly.newPlot('wind-gusts', traces, {
            ...layoutBase, xaxis: { ...layoutBase.xaxis, title: 'Hora del Día (00-23h)', type: 'linear' },
            yaxis: { ...layoutBase.yaxis, title: 'Ráfaga Máxima (kt)', type: 'linear' }
        }, {responsive: true});
    };
    ['gusts-airport', 'gusts-date-start', 'gusts-date-end', 'gusts-time-start', 'gusts-time-end'].forEach(id => {
        document.getElementById(id).addEventListener('change', render);
    });
    render();
}

// 4. Vis Traffic (Heatmap & Area)
function setupVisTraffic(data) {
    const selApt = document.getElementById('vis-airport');
    const selType = document.getElementById('vis-chart-type');
    const render = () => {
        let d = dateFilter(data, 'vis-date-start', 'vis-date-end');
        if(selApt.value !== 'Todos') d = d.filter(x => x.airport === selApt.value);
        
        if (selType.value === 'heatmap') {
            const hours = [...Array(24).keys()];
            const zValues = MONTH_NAMES.map(m => {
                return hours.map(h => {
                    const recs = d.filter(x => x.month_name === m && x.hour === h && x.volume_group === 'ALTA');
                    if(recs.length === 0) return 0;
                    const tot = recs.reduce((s, r) => s + Number(r.total), 0);
                    const low = recs.reduce((s, r) => s + Number(r.low_vis_count), 0);
                    return tot > 0 ? (low/tot)*100 : 0;
                });
            });
            Plotly.newPlot('vis-traffic', [{
                z: zValues, x: hours.map(h=>h+'h'), y: MONTH_NAMES, type: 'heatmap', colorscale: 'YlOrRd'
            }], { ...layoutBase, margin: {l: 80, r: 20, t: 30, b: 50}, title: '% Baja Visibilidad en Tráfico ALTO' }, {responsive: true});
        } else {
            const hours = [...Array(24).keys()];
            const yTraffic = hours.map(h => {
                return d.filter(x => x.hour === h && x.volume_group === 'ALTA').reduce((s, r) => s + Number(r.total), 0);
            });
            const yLowVis = hours.map(h => {
                return d.filter(x => x.hour === h && x.volume_group === 'ALTA').reduce((s, r) => s + Number(r.low_vis_count), 0);
            });
            Plotly.newPlot('vis-traffic', [
                { x: hours.map(h=>h+'h'), y: yTraffic, name: 'Vuelos ALTA', type: 'scatter', fill: 'tozeroy', marker: {color: '#979DAC'} },
                { x: hours.map(h=>h+'h'), y: yLowVis, name: 'Reportes Baja Vis', type: 'scatter', mode: 'lines+markers', yaxis: 'y2', line: {color: THEME.colors.ALTA, width: 3} }
            ], { 
                ...layoutBase, title: 'Perfil Diario 24h (Tráfico ALTO)', 
                yaxis: { ...layoutBase.yaxis, type: 'linear', title: 'Volumen Total' },
                yaxis2: { title: 'Baja Vis', overlaying: 'y', side: 'right', showgrid: false, font: { color: THEME.colors.ALTA } }
            }, {responsive: true});
        }
    };
    ['vis-airport', 'vis-chart-type', 'vis-date-start', 'vis-date-end'].forEach(id => {
        document.getElementById(id).addEventListener('change', render);
    });
    render();
}

// 5. Cloud Amounts
function setupCloudAmounts(data) {
    const selApt = document.getElementById('clouds-airport');
    const selMonths = document.getElementById('clouds-months');
    const render = () => {
        let d = data;
        if(selApt.value !== 'Todos') d = d.filter(x => x.airport === selApt.value);
        const selectedMonths = Array.from(selMonths.selectedOptions).map(opt => opt.value);
        const traces = selectedMonths.map(month => {
            const sub = d.filter(x => x.month_name === month);
            const hours = [...Array(24).keys()];
            return {
                x: hours.map(h => h + 'h'),
                y: hours.map(h => sub.filter(x => x.hour === h).reduce((sum, r) => sum + Number(r.count), 0)),
                type: 'bar', name: month
            };
        });
        Plotly.newPlot('cloud-amounts', traces, { ...layoutBase, barmode: 'group', xaxis: { ...layoutBase.xaxis, title: 'Hora del Día' }, yaxis: { ...layoutBase.yaxis, title: 'Duración (Horas)', type: 'linear' } }, {responsive: true});
    };
    selApt.addEventListener('change', render); selMonths.addEventListener('change', render); render();
}

// 6. Monthly Evo (Continuous Line by Airport)
function setupMonthlyEvo(data) {
    const selMonths = document.getElementById('evo-months');
    const selApt = document.getElementById('evo-airport');
    const render = () => {
        let d = data;
        if(selApt.value !== 'Todos') d = d.filter(x => x.airport === selApt.value);
        const selectedMonths = Array.from(selMonths.selectedOptions).map(opt => opt.value);
        
        d = d.filter(x => {
            const m = parseInt(x.date.split('-')[1]);
            return selectedMonths.includes(MONTH_NAMES[m-1]);
        });
        d.sort((a,b) => new Date(a.date) - new Date(b.date));
        
        const airports = [...new Set(d.map(x => x.airport))];
        const hours = [...Array(24).keys()];
        const traces = [];
        
        airports.forEach(apt => {
            const sub = d.filter(x => x.airport === apt);
            const yVis = hours.map(h => {
                const recs = sub.filter(x => x.hour === h);
                return recs.length ? recs.reduce((s, r) => s + Number(r.visibility), 0) / recs.length / 1000 : 0;
            });
            traces.push({ x: hours.map(h=>h+'h'), y: yVis.map(v => Number(v.toFixed(0))), type: 'scatter', mode: 'lines', name: apt + ' Vis(km)', yaxis: 'y1' });
        });
        
        airports.forEach(apt => {
            const sub = d.filter(x => x.airport === apt);
            const yTemp = hours.map(h => {
                const recs = sub.filter(x => x.hour === h);
                return recs.length ? recs.reduce((s, r) => s + Number(r.temperature), 0) / recs.length : 0;
            });
            const yTempClean = yTemp.map(t => typeof t === 'number' && !isNaN(t) ? Number(t.toFixed(1)) : 0);
            traces.push({ x: hours.map(h=>h+'h'), y: yTempClean, type: 'scatter', mode: 'lines', name: apt + ' Temp(ºC)', yaxis: 'y2', line: {dash: 'dot'} });
        });

        Plotly.newPlot('monthly-evo', traces, { 
            ...layoutBase, margin: { ...layoutBase.margin, l: 60, r: 60 }, 
            xaxis: { ...layoutBase.xaxis, title: 'Hora del Día (00-23h)' }, 
            yaxis: { ...layoutBase.yaxis, title: 'Visibilidad (km)', side: 'left', type: 'linear' },
            yaxis2: { ...layoutBase.yaxis, title: 'Temperatura (ºC)', side: 'right', overlaying: 'y', type: 'linear' }
        }, {responsive: true});
    };
    ['evo-months', 'evo-airport'].forEach(id => {
        document.getElementById(id).addEventListener('change', render);
    });
    render();
}

// 7. Scatter 3D
function setupScatter3D(data) {
    const selApt = document.getElementById('scatter3d-airport');
    const selRes = document.getElementById('scatter3d-resolution');
    
    const render = () => {
        let d = dateFilter(data, 'scatter3d-date-start', 'scatter3d-date-end');
        if(selApt.value !== 'Todos') d = d.filter(x => x.airport === selApt.value);
        
        // Filter by hour range
        const hStart = parseInt(document.getElementById('scatter3d-time-start').value || "0");
        const hEnd = parseInt(document.getElementById('scatter3d-time-end').value || "23");
        d = d.filter(x => x.hour >= hStart && x.hour <= hEnd);

        // Group by resolution
        const res = selRes.value; // 30m, 1h, 3h, 6h, 12h, 1d
        if (res !== '30m' && d.length > 0) {
            const grouped = {};
            d.forEach(r => {
                let groupKey = r.date;
                if(res === '1h') groupKey += `_H${r.hour}`;
                if(res === '3h') groupKey += `_H${Math.floor(r.hour/3)*3}`;
                if(res === '6h') groupKey += `_H${Math.floor(r.hour/6)*6}`;
                if(res === '12h') groupKey += `_H${Math.floor(r.hour/12)*12}`;
                // 1d uses just r.date
                if(!grouped[groupKey]) grouped[groupKey] = { t:0, d:0, v:0, c:0 };
                grouped[groupKey].t += r.temperature;
                grouped[groupKey].d += r.dewPoint;
                grouped[groupKey].v += r.visibility;
                grouped[groupKey].c += 1;
            });
            d = Object.keys(grouped).map(k => ({
                temperature: grouped[k].t / grouped[k].c,
                dewPoint: grouped[k].d / grouped[k].c,
                visibility: grouped[k].v / grouped[k].c,
                hourStr: k.split('_').length > 1 ? k.split('_')[1] : 'Promedio Diario'
            }));
        }

        const trace = {
            x: d.map(x => x.temperature), y: d.map(x => x.dewPoint), z: d.map(x => x.visibility),
            text: d.map(x => `Hora: ${x.hourStr || x.hour+'h'}<br>Temp: ${x.temperature.toFixed(1)}ºC<br>DewPt: ${x.dewPoint.toFixed(1)}ºC<br>Vis: ${x.visibility.toFixed(0)}m`),
            hovertemplate: '%{text}<extra></extra>',
            mode: 'markers', type: 'scatter3d', marker: { size: 3, opacity: 0.8, color: d.map(x => x.visibility), colorscale: 'Viridis' }
        };
        Plotly.newPlot('scatter-3d', [trace], { ...layoutBase, margin: {l:0, r:0, b:0, t:0}, scene: { xaxis: { title: 'Temp (C)' }, yaxis: { title: 'Dew Pt (C)' }, zaxis: { title: 'Visibility (m)' }, bgcolor: THEME.bg_main } }, {responsive: true});
    };
    ['scatter3d-airport', 'scatter3d-date-start', 'scatter3d-date-end', 'scatter3d-time-start', 'scatter3d-time-end', 'scatter3d-resolution'].forEach(id => {
        document.getElementById(id).addEventListener('change', render);
    });
    render();
}

// 8. Radar Cond
function setupRadarCond(data) {
    const selApt = document.getElementById('radar-airport');
    const selType = document.getElementById('radar-chart-type');
    const render = () => {
        let d = dateFilter(data, 'radar-date-start', 'radar-date-end');
        if (selApt.value !== 'Todos') d = d.filter(x => x.airport === selApt.value);
        
        const hStart = parseInt(document.getElementById('radar-time-start').value || "0");
        const hEnd = parseInt(document.getElementById('radar-time-end').value || "23");
        d = d.filter(x => x.hour >= hStart && x.hour <= hEnd);
        
        if (selType.value === 'heatmap') {
            // Composite Risk Index (0 to 1)
            d.forEach(x => { x.risk = (x.is_low_vis + x.is_high_wind + x.is_low_ceiling + x.has_rain + x.has_fog) / 5; });
            const dates = [...new Set(d.map(x => x.date))].sort();
            const z = [dates.map(date => {
                const recs = d.filter(x => x.date === date);
                return recs.length ? (recs.reduce((s, r) => s + r.risk, 0) / recs.length) * 100 : 0;
            })];
            Plotly.newPlot('radar-cond', [{ z: z, x: dates, y: ['Riesgo'], type: 'heatmap', colorscale: 'RdYlGn', reversescale: true }], { ...layoutBase, margin: {l: 50, r: 20, t: 30, b: 50} }, {responsive: true});
        } else {
            // Parcoords
            Plotly.newPlot('radar-cond', [{
                type: 'parcoords', 
                line: { color: d.map(x => x.is_low_vis), colorscale: 'Jet' },
                labelfont: { color: 'black' },
                tickfont: { color: 'black' },
                rangefont: { color: 'black' },
                dimensions: [
                    { label: 'Baja Vis', values: d.map(x => x.is_low_vis) },
                    { label: 'Viento', values: d.map(x => x.is_high_wind) },
                    { label: 'Techo', values: d.map(x => x.is_low_ceiling) },
                    { label: 'Lluvia', values: d.map(x => x.has_rain) },
                    { label: 'Niebla', values: d.map(x => x.has_fog) }
                ]
            }], { ...layoutBase, margin: {t: 50, b: 20}, plot_bgcolor: '#FFFFFF', paper_bgcolor: '#FFFFFF' }, {responsive: true});
        }
    };
    ['radar-airport', 'radar-chart-type', 'radar-date-start', 'radar-date-end', 'radar-time-start', 'radar-time-end'].forEach(id => {
        document.getElementById(id).addEventListener('change', render);
    });
    render();
}

// 9. Climate Table
function setupClimateTable(data) {
    const selApt = document.getElementById('climate-airport');
    const tbody = document.querySelector('#climate-table tbody');
    const render = () => {
        tbody.innerHTML = '';
        const apt = selApt.value;
        const d = data.filter(x => x.airport === apt).sort((a,b) => a.month - b.month);
        
        // Find max values for color scaling (Risk columns)
        const maxVals = { snow: Math.max(...d.map(x=>x.has_snow)), storm: Math.max(...d.map(x=>x.has_storm)), frost: Math.max(...d.map(x=>x.has_frost)), fog: Math.max(...d.map(x=>x.has_fog)), rain: Math.max(...d.map(x=>x.has_rain)) };
        const getColor = (val, max) => max > 0 ? `rgba(214, 40, 40, ${0.1 + (val/max)*0.8})` : 'transparent';

        d.forEach(r => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${MONTH_NAMES[r.month-1]}</td>
                <td>${r.mean_temp.toFixed(1)}</td><td>${r.max_temp.toFixed(1)}</td><td>${r.min_temp.toFixed(1)}</td>
                <td style="background-color: ${getColor(r.has_snow, maxVals.snow)}">${r.has_snow}</td>
                <td style="background-color: ${getColor(r.has_storm, maxVals.storm)}">${r.has_storm}</td>
                <td style="background-color: ${getColor(r.has_frost, maxVals.frost)}">${r.has_frost}</td>
                <td style="background-color: ${getColor(r.has_fog, maxVals.fog)}">${r.has_fog}</td>
                <td style="background-color: ${getColor(r.has_rain, maxVals.rain)}">${r.has_rain}</td>
                <td style="color: #F7B801; font-weight: bold;">${r.sunshine_hours}</td>
            `;
            tbody.appendChild(tr);
        });
    };
    selApt.addEventListener('change', render); render();
}

// 16. Macro Phenomena Bar
function setupMacroPhen(data) {
    const selApt = document.getElementById('macro-phen-airport'); // multiselect
    const selType = document.getElementById('macro-phen-type');
    const selRes = document.getElementById('macro-phen-res');
    const render = () => {
        let d = dateFilter(data, 'macro-phen-date-start', 'macro-phen-date-end');
        d = d.filter(x => x.phen_macro === selType.value);
        const selectedApts = Array.from(selApt.selectedOptions).map(opt => opt.value);
        d = d.filter(x => selectedApts.includes(x.airport));

        // Grouping
        const formatT = (dateStr) => {
            const dt = new Date(dateStr);
            if (selRes.value === 'month') return MONTH_NAMES[dt.getMonth()];
            if (selRes.value === 'quarter') return `Q${Math.ceil((dt.getMonth()+1)/3)}`;
            if (selRes.value === 'week') {
                const w = Math.ceil((((dt - new Date(dt.getFullYear(),0,1))/86400000)+1)/7);
                return `Sem ${w}`;
            }
            return dateStr;
        };

        const traces = selectedApts.map(apt => {
            const aptData = d.filter(x => x.airport === apt);
            const grouped = {};
            aptData.forEach(r => {
                const tk = formatT(r.date);
                grouped[tk] = (grouped[tk] || 0) + r.count;
            });
            const xKeys = [...new Set(aptData.map(r => formatT(r.date)))];
            return { x: xKeys, y: xKeys.map(k => grouped[k] || 0), type: 'bar', name: apt };
        });

        Plotly.newPlot('macro-phen-chart', traces, { ...layoutBase, barmode: 'group', yaxis: { ...layoutBase.yaxis, title: 'Frecuencia', type: 'linear' } }, {responsive: true});
    };
    ['macro-phen-airport', 'macro-phen-type', 'macro-phen-date-start', 'macro-phen-date-end', 'macro-phen-res'].forEach(id => {
        document.getElementById(id).addEventListener('change', render);
    });
    render();
}

// 10. Hourly Temp Boxplot
function setupTempBoxplot(data) {
    const selApt = document.getElementById('boxplot-airport');
    const render = () => {
        let d = dateFilter(data, 'boxplot-date-start', 'boxplot-date-end');
        if(selApt.value !== 'Todos') d = d.filter(x => x.airport === selApt.value);
        
        const hours = [...Array(24).keys()].map(h => h.toString().padStart(2, '0') + 'h');
        const traces = hours.map((h, i) => {
            return {
                y: d.filter(x => x.hour === i).map(x => Number(x.temperature)),
                type: 'box', name: h, marker: { color: '#F7B801' }, hovertemplate: '%{y:.1f} ºC<extra></extra>'
            };
        });

        Plotly.newPlot('temp-boxplot', traces, { ...layoutBase, showlegend: false, margin: { t: 30, r: 20, b: 50, l: 80 }, xaxis: { ...layoutBase.xaxis, title: 'Hora del Día' }, yaxis: { ...layoutBase.yaxis, title: 'Temperatura (ºC)', type: 'linear' } }, {responsive: true});
    };
    ['boxplot-airport', 'boxplot-date-start', 'boxplot-date-end'].forEach(id => {
        document.getElementById(id).addEventListener('change', render);
    });
    render();
}

// 15. Temp Stacked Bar
function setupTempStack(data) {
    const selApt = document.getElementById('temp-stack-airport');
    const render = () => {
        let d = dateFilter(data, 'temp-stack-date-start', 'temp-stack-date-end');
        if(selApt.value !== 'Todos') d = d.filter(x => x.airport === selApt.value);
        
        const intervals = ['<-10ºC', '-10/-6', '-5/-1', '0/4', '5/9', '10/14', '15/19', '20/24', '25/29', '30/34', '35/40', '>40ºC'];
        const hours = [...Array(24).keys()];
        const traces = intervals.map(inter => {
            return {
                x: hours,
                y: hours.map(h => d.filter(x => x.hour === h && x.temp_bin === inter).reduce((s, r) => s + r.count, 0)),
                name: inter, type: 'bar'
            };
        });

        Plotly.newPlot('temp-stack-chart', traces, { ...layoutBase, barmode: 'stack', barnorm: 'percent', xaxis: { ...layoutBase.xaxis, title: 'Hora (00-23)', tickmode: 'linear' }, yaxis: { ...layoutBase.yaxis, title: '% Frecuencia', type: 'linear' } }, {responsive: true});
    };
    ['temp-stack-airport', 'temp-stack-date-start', 'temp-stack-date-end'].forEach(id => {
        document.getElementById(id).addEventListener('change', render);
    });
    render();
}

// 11. Wind Direction Freq
function setupWindDir(data) {
    const selApt = document.getElementById('wind-dir-airport');
    const render = () => {
        let d = dateFilter(data, 'wind-dir-date-start', 'wind-dir-date-end');
        if(selApt.value !== 'Todos') d = d.filter(x => x.airport === selApt.value);
        
        const agg = {};
        d.forEach(r => { agg[r.wind_category] = (agg[r.wind_category] || 0) + r.count; });
        const sectors = ['01', '04', '07', '10', '13', '16', '19', '22', '25', '28', '31', '34'];
        const rValues = sectors.map(s => agg[s] || 0);
        Plotly.newPlot('wind-dir-chart', [{ type: 'scatterpolar', r: rValues, theta: sectors, fill: 'toself', name: 'Dirección' }], { ...layoutBase, polar: { angularaxis: { direction: 'clockwise', color: THEME.text_primary }, bgcolor: THEME.bg_main } }, {responsive: true});
    };
    ['wind-dir-airport', 'wind-dir-date-start', 'wind-dir-date-end'].forEach(id => {
        document.getElementById(id).addEventListener('change', render);
    });
    render();
}

// Visor 3D (Consolidated 12, 13, 14)
function setupVisor3D(cloudData, visData, rvrData) {
    const el = document.getElementById('visor-3d-gl');
    if(!el) return;
    const chart = echarts.init(el);
    const selApt = document.getElementById('visor3d-airport');
    const selMetric = document.getElementById('visor3d-metric');
    
    const render = () => {
        let dataMap = { 'clouds': {d: cloudData, col: 'cloud_base_bin', tit: 'Techo'}, 'vis': {d: visData, col: 'vis_bin', tit: 'Visibilidad'}, 'rvr': {d: rvrData, col: 'rvr_bin', tit: 'RVR'} };
        let current = dataMap[selMetric.value];
        let d = dateFilter(current.d, 'visor3d-date-start', 'visor3d-date-end');
        
        if(selApt.value !== 'Todos') d = d.filter(x => x.airport === selApt.value);
        d = d.filter(x => x[current.col] !== null);
        
        const hours = [...Array(24).keys()].map(h => h.toString().padStart(2, '0') + 'h');
        const bins = [...new Set(d.map(x => x[current.col]))];
        bins.sort((a,b) => {
            let numA = parseInt(a.replace(/\D/g, '')) || 0; let numB = parseInt(b.replace(/\D/g, '')) || 0;
            if (a.includes('>')) numA += 10000; if (b.includes('>')) numB += 10000;
            return numA - numB;
        });

        const agg = {};
        d.forEach(r => { const key = `${r.hour}_${r[current.col]}`; agg[key] = (agg[key] || 0) + r.count; });
        const seriesData = [];
        for(let h=0; h<24; h++) {
            for(let b=0; b<bins.length; b++) {
                const key = `${h}_${bins[b]}`;
                if(agg[key]) seriesData.push([h, b, agg[key]]);
            }
        }

        const maxVal = Math.max(...seriesData.map(v => v[2]), 10);
        chart.setOption({
            tooltip: { formatter: p => `Hora: ${hours[p.value[0]]}<br/>Rango: ${bins[p.value[1]]}<br/>Count: ${p.value[2]}` },
            visualMap: { max: maxVal, inRange: { color: ['#313695', '#4575b4', '#74add1', '#abd9e9', '#e0f3f8', '#ffffbf', '#fee090', '#fdae61', '#f46d43', '#d73027', '#a50026'] }, textStyle: { color: '#fff' } },
            xAxis3D: { type: 'category', data: hours, name: 'Hora', nameTextStyle: {color: '#fff'}, axisLabel: {color: '#979DAC'} },
            yAxis3D: { type: 'category', data: bins, name: current.tit, nameTextStyle: {color: '#fff'}, axisLabel: {color: '#979DAC'} },
            zAxis3D: { type: 'value', name: 'Frecuencia', nameTextStyle: {color: '#fff'}, axisLabel: {color: '#979DAC'} },
            grid3D: { boxWidth: 200, boxDepth: 80, boxHeight: 100, viewControl: { autoRotate: false, distance: 300, alpha: 20, beta: 40 }, light: { main: { intensity: 1.2, shadow: true }, ambient: { intensity: 0.3 } } },
            series: [{ type: 'bar3D', data: seriesData, shading: 'lambert', label: { show: false }, itemStyle: { opacity: 0.9 } }]
        }, true); // true forces clear
    };
    ['visor3d-airport', 'visor3d-metric', 'visor3d-date-start', 'visor3d-date-end'].forEach(id => document.getElementById(id).addEventListener('change', render));
    window.addEventListener('resize', () => chart.resize());
    render();
}

window.onload = initDashboard;
