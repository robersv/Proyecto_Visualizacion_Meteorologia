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

function populateSelect(selectId, options, includeAll = true) {
    const select = document.getElementById(selectId);
    if (!select) return;
    // Keep 'Todos' if it exists, clear rest
    while (select.options.length > (includeAll ? 1 : 0)) {
        select.remove(includeAll ? 1 : 0);
    }
    options.forEach(opt => select.add(new Option(opt, opt)));
}

async function initDashboard() {
    try {
        const [
            phenData, windRoseData, visData, cloudData, 
            monthlyData, radarData, gustsData, scatter3dData,
            // Phase 3 files
            climateData, dailyTempData, windDirData, cloud3dData,
            vis3dData, rvr3dData, tempStackData, macroPhenData
        ] = await Promise.all([
            loadData('phenomena_distribution.json'),
            loadData('wind_rose.json'),
            loadData('visibility_vs_traffic.json'),
            loadData('cloud_amounts.json'),
            loadData('monthly_evolution.json'),
            loadData('radar_bad_conditions.json'),
            loadData('wind_gusts.json'),
            loadData('3d_scatter_data.json'),
            // Phase 3 files
            loadData('climatological_summary.json'),
            loadData('daily_temperature.json'),
            loadData('wind_direction_freq.json'),
            loadData('cloud_base_3d.json'),
            loadData('visibility_3d.json'),
            loadData('rvr_sim_3d.json'),
            loadData('temp_intervals_freq.json'),
            loadData('phenomena_macro_freq.json')
        ]);

        const airports = [...new Set(phenData.map(d => d.airport))].sort();
        const allSelectors = [
            'wind-rose-airport', 'gusts-airport', 'vis-airport', 'clouds-airport', 
            'evo-airport', 'scatter3d-airport', 'radar-airport',
            'climate-airport', 'macro-phen-airport', 'boxplot-airport',
            'temp-stack-airport', 'wind-dir-airport', 'cloud3d-airport',
            'vis3d-airport', 'rvr3d-airport'
        ];
        
        allSelectors.forEach(id => {
            // For climate table we might not want 'Todos' as default, but we left it in HTML.
            // Let's just populate them.
            if(id === 'climate-airport') {
                populateSelect(id, airports, false); // No "Todos" for the table, usually confusing
            } else {
                populateSelect(id, airports);
            }
        });

        // 1. Phenomena Dist
        plotPhenomenaDist(phenData);
        // 2. Wind Rose
        setupWindRose(windRoseData);
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
        setupRadarCond(radarData);

        // --- PHASE 3 SETUP ---
        setupClimateTable(climateData);
        setupMacroPhen(macroPhenData);
        setupTempBoxplot(dailyTempData);
        setupTempStack(tempStackData);
        setupWindDir(windDirData);
        
        // ECharts GL 3D Setup
        setup3DGL('cloud-3d-gl', 'cloud3d-airport', cloud3dData, 'cloud_base_bin', 'Techo de Nubes');
        setup3DGL('vis-3d-gl', 'vis3d-airport', vis3dData, 'vis_bin', 'Visibilidad General');
        setup3DGL('rvr-3d-gl', 'rvr3d-airport', rvr3dData, 'rvr_bin', 'Simulación RVR');

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

    const threshold = total * 0.10;
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
function setupWindRose(data) {
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

// 4. Vis Traffic
function setupVisTraffic(data) {
    const selApt = document.getElementById('vis-airport');
    const render = () => {
        let d = data;
        if(selApt.value !== 'Todos') d = d.filter(x => x.airport === selApt.value);
        
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

// --- PHASE 3 IMPLEMENTATION ---

// 9. Climate Table
function setupClimateTable(data) {
    const selApt = document.getElementById('climate-airport');
    const tbody = document.querySelector('#climate-table tbody');
    
    const monthNames = {1:'Ene',2:'Feb',3:'Mar',4:'Abr',5:'May',6:'Jun',7:'Jul',8:'Ago',9:'Sep',10:'Oct',11:'Nov',12:'Dic'};

    const render = () => {
        tbody.innerHTML = '';
        const apt = selApt.value;
        const d = data.filter(x => x.airport === apt).sort((a,b) => a.month - b.month);
        
        d.forEach(r => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${monthNames[r.month]}</td>
                <td>${r.mean_temp.toFixed(1)}</td>
                <td>${r.max_temp.toFixed(1)}</td>
                <td>${r.min_temp.toFixed(1)}</td>
                <td>${r.has_snow}</td>
                <td>${r.has_storm}</td>
                <td>${r.has_frost}</td>
                <td>${r.has_fog}</td>
                <td>${r.has_rain}</td>
                <td style="color: #F7B801; font-weight: bold;">${r.sunshine_hours}</td>
            `;
            tbody.appendChild(tr);
        });
    };
    selApt.addEventListener('change', render);
    render();
}

// 16. Macro Phenomena Bar
function setupMacroPhen(data) {
    const selApt = document.getElementById('macro-phen-airport');
    const render = () => {
        let d = data;
        if(selApt.value !== 'Todos') d = d.filter(x => x.airport === selApt.value);
        
        const agg = {};
        let total = 0;
        d.forEach(r => {
            agg[r.phen_macro] = (agg[r.phen_macro] || 0) + r.count;
            total += r.count;
        });

        const categories = Object.keys(agg);
        const values = categories.map(c => (agg[c]/total)*100);

        Plotly.newPlot('macro-phen-chart', [{
            x: categories, y: values, type: 'bar',
            marker: { color: ['#48CAE4', '#F7B801', '#D62828', '#979DAC'] }
        }], { ...layoutBase, yaxis: { ...layoutBase.yaxis, title: '% Frecuencia' }}, {responsive: true});
    };
    selApt.addEventListener('change', render);
    render();
}

// 10. Daily Temp Boxplot
function setupTempBoxplot(data) {
    const selApt = document.getElementById('boxplot-airport');
    const render = () => {
        let d = data;
        if(selApt.value !== 'Todos') d = d.filter(x => x.airport === selApt.value);
        
        const traces = [
            { y: d.map(x => x.max_temp), type: 'box', name: 'Máxima', marker: { color: '#D62828' } },
            { y: d.map(x => x.mean_temp), type: 'box', name: 'Media', marker: { color: '#F7B801' } },
            { y: d.map(x => x.min_temp), type: 'box', name: 'Mínima', marker: { color: '#48CAE4' } }
        ];

        Plotly.newPlot('temp-boxplot', traces, { ...layoutBase, yaxis: { ...layoutBase.yaxis, title: 'Temperatura (ºC)' } }, {responsive: true});
    };
    selApt.addEventListener('change', render);
    render();
}

// 15. Temp Stacked Bar
function setupTempStack(data) {
    const selApt = document.getElementById('temp-stack-airport');
    const render = () => {
        let d = data;
        if(selApt.value !== 'Todos') d = d.filter(x => x.airport === selApt.value);
        
        const intervals = ['<-10ºC', '-10/-6', '-5/-1', '0/4', '5/9', '10/14', '15/19', '20/24', '25/29', '30/34', '35/40', '>40ºC'];
        const hours = [...Array(24).keys()];
        
        const traces = intervals.map(inter => {
            return {
                x: hours,
                y: hours.map(h => {
                    const rows = d.filter(x => x.hour === h && x.temp_bin === inter);
                    return rows.reduce((sum, r) => sum + r.count, 0);
                }),
                name: inter, type: 'bar'
            };
        });

        Plotly.newPlot('temp-stack-chart', traces, {
            ...layoutBase, 
            barmode: 'stack', barnorm: 'percent',
            xaxis: { ...layoutBase.xaxis, title: 'Hora (00-23)', tickmode: 'linear' },
            yaxis: { ...layoutBase.yaxis, title: '% Frecuencia' }
        }, {responsive: true});
    };
    selApt.addEventListener('change', render);
    render();
}

// 11. Wind Direction Freq
function setupWindDir(data) {
    const selApt = document.getElementById('wind-dir-airport');
    const render = () => {
        let d = data;
        if(selApt.value !== 'Todos') d = d.filter(x => x.airport === selApt.value);
        
        const agg = {};
        d.forEach(r => { agg[r.wind_category] = (agg[r.wind_category] || 0) + r.count; });
        
        const sectors = ['01', '04', '07', '10', '13', '16', '19', '22', '25', '28', '31', '34'];
        
        // Poligonal graph for sectors
        const rValues = sectors.map(s => agg[s] || 0);
        
        const traces = [{
            type: 'scatterpolar', r: rValues, theta: sectors, fill: 'toself', name: 'Dirección'
        }];

        Plotly.newPlot('wind-dir-chart', traces, {
            ...layoutBase, polar: {
                angularaxis: { direction: 'clockwise', color: THEME.text_primary },
                bgcolor: THEME.bg_main
            }
        }, {responsive: true});
        
        // Note: Calma could be displayed as a central annotation if needed.
    };
    selApt.addEventListener('change', render);
    render();
}

// 12, 13, 14. ECharts GL 3D Bars
function setup3DGL(containerId, selectId, data, binCol, title) {
    const el = document.getElementById(containerId);
    if(!el) return;
    const chart = echarts.init(el);
    const selApt = document.getElementById(selectId);
    
    const render = () => {
        let d = data;
        if(selApt.value !== 'Todos') d = d.filter(x => x.airport === selApt.value);
        
        // Remove null bins
        d = d.filter(x => x[binCol] !== null);
        
        const hours = [...Array(24).keys()].map(h => h.toString().padStart(2, '0') + 'h');
        const bins = [...new Set(d.map(x => x[binCol]))];
        
        bins.sort((a,b) => {
            let numA = parseInt(a.replace(/\D/g, '')) || 0;
            let numB = parseInt(b.replace(/\D/g, '')) || 0;
            if (a.includes('>')) numA += 10000;
            if (b.includes('>')) numB += 10000;
            return numA - numB;
        });

        // Group by hour and bin to aggregate if airport=='Todos'
        const agg = {};
        d.forEach(r => {
            const key = `${r.hour}_${r[binCol]}`;
            agg[key] = (agg[key] || 0) + r.count;
        });

        const seriesData = [];
        for(let h=0; h<24; h++) {
            for(let b=0; b<bins.length; b++) {
                const key = `${h}_${bins[b]}`;
                if(agg[key]) {
                    seriesData.push([h, b, agg[key]]);
                }
            }
        }

        const maxVal = Math.max(...seriesData.map(v => v[2]), 10);

        const option = {
            tooltip: {
                formatter: function (params) {
                    return `Hora: ${hours[params.value[0]]}<br/>Rango: ${bins[params.value[1]]}<br/>Count: ${params.value[2]}`;
                }
            },
            visualMap: {
                max: maxVal,
                inRange: { color: ['#313695', '#4575b4', '#74add1', '#abd9e9', '#e0f3f8', '#ffffbf', '#fee090', '#fdae61', '#f46d43', '#d73027', '#a50026'] },
                textStyle: { color: '#fff' }
            },
            xAxis3D: { type: 'category', data: hours, name: 'Hora', nameTextStyle: {color: '#fff'}, axisLabel: {color: '#979DAC'} },
            yAxis3D: { type: 'category', data: bins, name: title, nameTextStyle: {color: '#fff'}, axisLabel: {color: '#979DAC'} },
            zAxis3D: { type: 'value', name: 'Conteo', nameTextStyle: {color: '#fff'}, axisLabel: {color: '#979DAC'} },
            grid3D: {
                boxWidth: 200, boxDepth: 80, boxHeight: 100,
                viewControl: { autoRotate: false, distance: 300, alpha: 20, beta: 40 },
                light: { main: { intensity: 1.2, shadow: true }, ambient: { intensity: 0.3 } }
            },
            series: [{
                type: 'bar3D',
                data: seriesData,
                shading: 'lambert',
                label: { show: false },
                itemStyle: { opacity: 0.9 }
            }]
        };
        chart.setOption(option);
    };
    selApt.addEventListener('change', render);
    window.addEventListener('resize', () => chart.resize());
    render();
}

window.onload = initDashboard;
