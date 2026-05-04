const THEME = {
    bg_main: '#0B132B',
    bg_card: '#1C2541',
    text_primary: '#FFFFFF',
    text_secondary: '#979DAC',
    grid_color: 'rgba(255, 255, 255, 0.08)',
    colors: { ALTA: '#D62828', MEDIA: '#F7B801', BAJA: '#06D6A0' },
    wind: '#48CAE4', cloud: '#979DAC'
};

const layoutBase = {
    plot_bgcolor: THEME.bg_card,
    paper_bgcolor: THEME.bg_card,
    font: { color: THEME.text_primary, family: 'Inter, sans-serif' },
    margin: { t: 30, l: 50, r: 20, b: 50 },
    xaxis: { gridcolor: THEME.grid_color, zerolinecolor: THEME.grid_color },
    yaxis: { gridcolor: THEME.grid_color, zerolinecolor: THEME.grid_color },
    legend: { orientation: 'h', y: -0.2 }
};

async function loadData(filename) {
    const res = await fetch(`data/${filename}`);
    if (!res.ok) throw new Error(`Could not load ${filename}`);
    return await res.json();
}

function populateSelect(selectId, options) {
    const select = document.getElementById(selectId);
    if (!select) return;
    options.forEach(opt => select.add(new Option(opt, opt)));
}

async function initDashboard() {
    try {
        const [
            phenData, windRoseData, visData, cloudData, 
            monthlyData, radarData, gustsData, scatter3dData
        ] = await Promise.all([
            loadData('phenomena_distribution.json'),
            loadData('wind_rose.json'),
            loadData('visibility_vs_traffic.json'),
            loadData('cloud_amounts.json'),
            loadData('monthly_evolution.json'),
            loadData('radar_bad_conditions.json'),
            loadData('wind_gusts.json'),
            loadData('3d_scatter_data.json')
        ]);

        const airports = [...new Set(phenData.map(d => d.airport))];
        ['wind-rose-airport', 'gusts-airport', 'vis-airport', 'clouds-airport', 'evo-airport', 'scatter3d-airport'].forEach(id => {
            populateSelect(id, airports);
        });
        
        // Radar has special airport selector
        const radarSelect = document.getElementById('radar-airport');
        airports.forEach(apt => radarSelect.add(new Option(apt, apt)));

        // 1. Phenomena Dist
        plotPhenomenaDist(phenData);
        
        // 2. Wind Rose
        setupWindRose(windRoseData, airports);
        
        // 3. Gusts (Scatter)
        setupWindGusts(gustsData);

        // 4. Vis Traffic (Bar)
        setupVisTraffic(visData);

        // 5. Cloud amounts (Bar, time series)
        setupCloudAmounts(cloudData);

        // 6. Monthly Evo (Line, time series)
        setupMonthlyEvo(monthlyData);

        // 7. 3D Scatter
        setupScatter3D(scatter3dData);

        // 8. Radar Cond
        setupRadarCond(radarData, airports);

    } catch (e) {
        console.error("Dashboard init error:", e);
    }
}

// 1. Phenomena
function plotPhenomenaDist(data) {
    let total = 0;
    const agg = {};
    data.forEach(d => {
        agg[d.phenomenon] = (agg[d.phenomenon] || 0) + d.count;
        total += d.count;
    });

    const threshold = total * 0.10; // 10%
    const grouped = { 'Otros': 0 };
    const tableData = [];

    for (const [phen, count] of Object.entries(agg)) {
        tableData.push({ phen, count, pct: (count/total)*100 });
        if (count < threshold) {
            grouped['Otros'] += count;
        } else {
            grouped[phen] = count;
        }
    }
    
    // Sort table descending
    tableData.sort((a,b) => b.count - a.count);
    const tbody = document.querySelector('#phenomena-table tbody');
    tableData.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${r.phen}</td><td>${r.count}</td><td>${r.pct.toFixed(2)}%</td>`;
        tbody.appendChild(tr);
    });

    const trace = {
        labels: Object.keys(grouped),
        values: Object.values(grouped),
        type: 'pie', hole: 0.4,
        marker: { colors: ['#48CAE4', '#F7B801', '#D62828', '#979DAC'] }
    };
    Plotly.newPlot('phenomena-dist', [trace], { ...layoutBase, margin: {t:10, b:10, l:10, r:10}}, {responsive: true});
}

// 2. Wind Rose
function setupWindRose(data, airports) {
    const selApt = document.getElementById('wind-rose-airport');
    const selSeason = document.getElementById('wind-rose-season');
    
    const render = () => {
        const apt = selApt.value;
        const season = selSeason.value;
        
        let d = data;
        if(apt !== 'Todos') d = d.filter(x => x.airport === apt);
        if(season !== 'Todos') d = d.filter(x => x.season === season);
        
        const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        const speeds = ['0-5', '5-10', '10-15', '15-20', '20+'];
        const colorScale = ['#90E0EF', '#48CAE4', '#00B4D8', '#0077B6', '#03045E'];

        const traces = speeds.map((speed, i) => {
            return {
                r: directions.map(dir => {
                    const rows = d.filter(x => x.wind_dir_cat === dir && x.wind_speed_cat === speed);
                    return rows.reduce((sum, r) => sum + r.count, 0);
                }),
                theta: directions,
                name: speed + ' kt', type: 'barpolar',
                marker: { color: colorScale[i] }
            };
        });

        Plotly.newPlot('wind-rose', traces, {
            ...layoutBase, polar: { angularaxis: { color: THEME.text_secondary }, bgcolor: THEME.bg_card }
        }, {responsive: true});
    };
    selApt.addEventListener('change', render);
    selSeason.addEventListener('change', render);
    render();
}

// 3. Gusts Scatter
function setupWindGusts(data) {
    const selApt = document.getElementById('gusts-airport');
    const render = () => {
        let d = data;
        if(selApt.value !== 'Todos') d = d.filter(x => x.airport === selApt.value);
        
        const traces = ['ALTA', 'MEDIA', 'BAJA'].map(lvl => {
            const sub = d.filter(r => r.volume_group === lvl);
            return {
                x: sub.map(r => r.knots), y: sub.map(r => r.maxKnots),
                mode: 'markers', type: 'scatter', name: lvl,
                marker: { color: THEME.colors[lvl], size: 6, opacity: 0.6 }
            };
        });
        Plotly.newPlot('wind-gusts', traces, {
            ...layoutBase, xaxis: { ...layoutBase.xaxis, title: 'Viento Sostenido (kt)' },
            yaxis: { ...layoutBase.yaxis, title: 'Ráfaga Máxima (kt)' }
        }, {responsive: true});
    };
    selApt.addEventListener('change', render);
    render();
}

// 4. Vis Traffic (Bar Pct)
function setupVisTraffic(data) {
    const selApt = document.getElementById('vis-airport');
    const render = () => {
        let d = data;
        if(selApt.value !== 'Todos') d = d.filter(x => x.airport === selApt.value);
        
        // aggregate
        const agg = {'ALTA':{l:0, t:0}, 'MEDIA':{l:0, t:0}, 'BAJA':{l:0, t:0}};
        d.forEach(r => {
            if(agg[r.volume_group]) {
                agg[r.volume_group].l += r.low_vis_count;
                agg[r.volume_group].t += r.total;
            }
        });
        
        const x = ['ALTA', 'MEDIA', 'BAJA'];
        const y = x.map(lvl => agg[lvl].t > 0 ? (agg[lvl].l / agg[lvl].t)*100 : 0);
        
        Plotly.newPlot('vis-traffic', [{
            x: x, y: y, type: 'bar',
            marker: { color: x.map(lvl => THEME.colors[lvl]) }
        }], { ...layoutBase, yaxis: { ...layoutBase.yaxis, title: '% Periodos Baja Vis (<1000m)' }}, {responsive: true});
    };
    selApt.addEventListener('change', render);
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
            const days = [...Array(31).keys()].map(i => i+1);
            return {
                x: days,
                y: days.map(day => {
                    return sub.filter(x => x.day === day).reduce((sum, r) => sum + r.count, 0);
                }),
                type: 'bar', name: month
            };
        });
        Plotly.newPlot('cloud-amounts', traces, {
            ...layoutBase, barmode: 'group', xaxis: { ...layoutBase.xaxis, title: 'Día del Mes' }
        }, {responsive: true});
    };
    selApt.addEventListener('change', render);
    selMonths.addEventListener('change', render);
    render();
}

// 6. Monthly Evo
function setupMonthlyEvo(data) {
    const selApt = document.getElementById('evo-airport');
    const selMonths = document.getElementById('evo-months');
    const render = () => {
        let d = data;
        if(selApt.value !== 'Todos') d = d.filter(x => x.airport === selApt.value);
        const selectedMonths = Array.from(selMonths.selectedOptions).map(opt => opt.value);
        
        const traces = selectedMonths.map(month => {
            const sub = d.filter(x => x.month_name === month);
            const days = [...Array(31).keys()].map(i => i+1);
            
            return {
                x: days,
                y: days.map(day => {
                    const recs = sub.filter(x => x.day === day);
                    if(!recs.length) return null;
                    return recs.reduce((sum, r) => sum + r.visibility, 0) / recs.length;
                }),
                type: 'scatter', mode: 'lines+markers', name: month
            };
        });
        Plotly.newPlot('monthly-evo', traces, {
            ...layoutBase, xaxis: { ...layoutBase.xaxis, title: 'Día del Mes' },
            yaxis: { ...layoutBase.yaxis, title: 'Visibilidad Promedio (m)' }
        }, {responsive: true});
    };
    selApt.addEventListener('change', render);
    selMonths.addEventListener('change', render);
    render();
}

// 7. Scatter 3D
function setupScatter3D(data) {
    const selApt = document.getElementById('scatter3d-airport');
    const render = () => {
        let d = data;
        if(selApt.value !== 'Todos') d = d.filter(x => x.airport === selApt.value);
        
        const months = [...new Set(d.map(x => x.month_name))];
        const traces = months.map(m => {
            const sub = d.filter(x => x.month_name === m);
            return {
                x: sub.map(x => x.temperature),
                y: sub.map(x => x.dewPoint),
                z: sub.map(x => x.visibility),
                mode: 'markers', type: 'scatter3d', name: m,
                marker: { size: 3, opacity: 0.8 }
            };
        });
        Plotly.newPlot('scatter-3d', traces, {
            ...layoutBase, margin: {l:0, r:0, b:0, t:0},
            scene: {
                xaxis: { title: 'Temp (C)' },
                yaxis: { title: 'Dew Pt (C)' },
                zaxis: { title: 'Visibility (m)' },
                bgcolor: THEME.bg_main
            }
        }, {responsive: true});
    };
    selApt.addEventListener('change', render);
    render();
}

// 8. Radar Cond
function setupRadarCond(data) {
    const selApt = document.getElementById('radar-airport');
    const render = () => {
        const apt = selApt.value;
        const vars = ['is_low_vis', 'is_high_wind', 'is_low_ceiling', 'has_rain', 'has_fog'];
        const labels = ['Baja Vis.', 'Viento Fuerte', 'Techo Bajo', 'Lluvia', 'Niebla'];
        
        let traces = [];
        if (apt === 'Todos') {
            traces = data.map(r => ({
                type: 'scatterpolar', r: vars.map(v => r[v]*100), theta: labels, fill: 'toself', name: r.airport
            }));
        } else {
            const r = data.find(x => x.airport === apt);
            if(r) {
                traces = [{
                    type: 'scatterpolar', r: vars.map(v => r[v]*100), theta: labels, fill: 'toself', name: r.airport
                }];
            }
        }

        Plotly.newPlot('radar-cond', traces, {
            ...layoutBase, polar: {
                radialaxis: { visible: true, range: [0, 100], color: THEME.text_secondary },
                angularaxis: { color: THEME.text_primary }, bgcolor: THEME.bg_main
            }
        }, {responsive: true});
    };
    selApt.addEventListener('change', render);
    render();
}

window.onload = initDashboard;
