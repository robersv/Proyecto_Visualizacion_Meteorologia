// Theme configuration (matches CSS)
const THEME = {
    bg_main: '#0B132B',
    bg_card: '#1C2541',
    text_primary: '#FFFFFF',
    text_secondary: '#979DAC',
    grid_color: 'rgba(255, 255, 255, 0.08)',
    colors: {
        ALTA: '#D62828',
        MEDIA: '#F7B801',
        BAJA: '#06D6A0'
    },
    wind: '#48CAE4',
    cloud: '#979DAC'
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

// Fetch Helper
async function loadData(filename) {
    const response = await fetch(`data/${filename}`);
    if (!response.ok) throw new Error(`Could not load ${filename}`);
    return await response.json();
}

async function initDashboard() {
    try {
        // Load data in parallel
        const [
            trafficData, phenData, windRoseData, visData, cloudData, 
            monthlyData, hourlyData, corrData, radarData, gustsData
        ] = await Promise.all([
            loadData('traffic_distribution.json'),
            loadData('phenomena_distribution.json'),
            loadData('wind_rose.json'),
            loadData('visibility_vs_traffic.json'),
            loadData('cloud_amounts.json'),
            loadData('monthly_evolution.json'),
            loadData('hourly_traffic.json'),
            loadData('correlation_heatmap.json'),
            loadData('radar_bad_conditions.json'),
            loadData('wind_gusts.json')
        ]);

        const airports = [...new Set(trafficData.map(d => d.airport))];

        // 1. Traffic Distribution (Grouped Bar)
        plotTrafficDist(trafficData);
        
        // 2. Phenomena Distribution (Donut / Pie)
        plotPhenomenaDist(phenData);
        
        // 3. Wind Rose
        setupWindRose(windRoseData, airports);
        
        // 4. Gusts Dispersion (Scatter)
        plotWindGusts(gustsData);

        // 5. Visibility vs Traffic (Boxplot)
        plotVisTraffic(visData);

        // 6. Cloud amounts (Donut)
        plotCloudAmounts(cloudData);

        // 7. Monthly Evolution (Line)
        plotMonthlyEvolution(monthlyData, airports);

        // 8. Hourly Traffic (Stacked Area)
        plotHourlyTraffic(hourlyData, airports);

        // 9. Correlation Heatmap
        setupCorrHeatmap(corrData, airports);

        // 10. Radar Bad Conditions
        plotRadarCond(radarData);

    } catch (e) {
        console.error("Dashboard initialization error:", e);
    }
}

// 1. Traffic Dist (Bar)
function plotTrafficDist(data) {
    const airports = [...new Set(data.map(d => d.airport))];
    const traces = ['ALTA', 'MEDIA', 'BAJA'].map(level => {
        return {
            x: airports,
            y: airports.map(apt => {
                const row = data.find(d => d.airport === apt);
                return row ? row[level] || 0 : 0;
            }),
            name: level,
            type: 'bar',
            marker: { color: THEME.colors[level] }
        };
    });

    Plotly.newPlot('traffic-dist', traces, {
        ...layoutBase,
        barmode: 'group',
        yaxis: { ...layoutBase.yaxis, title: 'Periodos (30m)' }
    }, {responsive: true});
}

// 2. Phenomena Dist (Donut)
function plotPhenomenaDist(data) {
    // Aggregate all airports
    const agg = {};
    data.forEach(d => {
        agg[d.phenomenon] = (agg[d.phenomenon] || 0) + d.count;
    });
    // Filter top 10
    const sorted = Object.entries(agg).sort((a,b) => b[1] - a[1]).slice(0, 10);
    
    const trace = {
        labels: sorted.map(d => d[0]),
        values: sorted.map(d => d[1]),
        type: 'pie',
        hole: 0.4,
        marker: {
            colors: ['#48CAE4', '#979DAC', '#F7B801', '#5C677D', '#1C2541']
        }
    };
    Plotly.newPlot('phenomena-dist', [trace], { ...layoutBase, margin: {t:10, b:10, l:10, r:10}}, {responsive: true});
}

// 3. Wind Rose
function setupWindRose(data, airports) {
    const select = document.getElementById('wind-rose-airport-select');
    airports.forEach(apt => select.add(new Option(apt, apt)));
    
    const render = (apt) => {
        const aptData = data.filter(d => d.airport === apt);
        const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        const speeds = ['0-5', '5-10', '10-15', '15-20', '20+'];
        const colorScale = ['#90E0EF', '#48CAE4', '#00B4D8', '#0077B6', '#03045E'];

        const traces = speeds.map((speed, i) => {
            return {
                r: directions.map(dir => {
                    const row = aptData.find(d => d.wind_dir_cat === dir && d.wind_speed_cat === speed);
                    return row ? row.count : 0;
                }),
                theta: directions,
                name: speed + ' kt',
                type: 'barpolar',
                marker: { color: colorScale[i] }
            };
        });

        Plotly.newPlot('wind-rose', traces, {
            plot_bgcolor: THEME.bg_card,
            paper_bgcolor: THEME.bg_card,
            font: { color: THEME.text_primary, family: 'Inter' },
            polar: {
                radialaxis: { visible: false },
                angularaxis: { color: THEME.text_secondary, gridcolor: THEME.grid_color },
                bgcolor: THEME.bg_card
            },
            margin: { t:20, b:20, l:20, r:20 }
        }, {responsive: true});
    };
    
    select.addEventListener('change', (e) => render(e.target.value));
    render(airports[0]);
}

// 4. Wind Gusts (Scatter)
function plotWindGusts(data) {
    const traces = ['ALTA', 'MEDIA', 'BAJA'].map(level => {
        const d = data.filter(r => r.volume_group === level);
        return {
            x: d.map(r => r.knots),
            y: d.map(r => r.maxKnots),
            mode: 'markers',
            type: 'scatter',
            name: level,
            marker: { color: THEME.colors[level], size: 6, opacity: 0.6 }
        };
    });
    Plotly.newPlot('wind-gusts', traces, {
        ...layoutBase,
        xaxis: { ...layoutBase.xaxis, title: 'Viento Sostenido (kt)' },
        yaxis: { ...layoutBase.yaxis, title: 'Ráfaga Máxima (kt)' }
    }, {responsive: true});
}

// 5. Visibility vs Traffic (Boxplot)
function plotVisTraffic(data) {
    const traces = ['ALTA', 'MEDIA', 'BAJA'].map(level => {
        const d = data.filter(r => r.volume_group === level);
        return {
            y: d.map(r => r.visibility),
            type: 'box',
            name: level,
            marker: { color: THEME.colors[level] }
        };
    });
    Plotly.newPlot('vis-traffic', traces, {
        ...layoutBase,
        yaxis: { ...layoutBase.yaxis, title: 'Visibilidad (m)' }
    }, {responsive: true});
}

// 6. Cloud Amounts (Bar)
function plotCloudAmounts(data) {
    // aggregate across airports for simplicity
    const agg = {};
    data.forEach(d => {
        agg[d.amount] = (agg[d.amount] || 0) + d.count;
    });
    
    const trace = {
        x: Object.keys(agg),
        y: Object.values(agg),
        type: 'bar',
        marker: { color: THEME.cloud }
    };
    Plotly.newPlot('cloud-amounts', [trace], layoutBase, {responsive: true});
}

// 7. Monthly Evolution (Line)
function plotMonthlyEvolution(data, airports) {
    const traces = airports.map(apt => {
        const d = data.filter(r => r.airport === apt).sort((a,b) => a.month.localeCompare(b.month));
        return {
            x: d.map(r => r.month),
            y: d.map(r => r.visibility),
            type: 'scatter',
            mode: 'lines+markers',
            name: apt
        };
    });
    Plotly.newPlot('monthly-evo', traces, {
        ...layoutBase,
        yaxis: { ...layoutBase.yaxis, title: 'Visibilidad Promedio (m)' }
    }, {responsive: true});
}

// 8. Hourly Traffic (Stacked Area)
function plotHourlyTraffic(data) {
    // Let's just sum across airports for global view
    const hours = [...Array(24).keys()];
    const traces = ['ALTA', 'MEDIA', 'BAJA'].map(level => {
        return {
            x: hours,
            y: hours.map(h => {
                const rows = data.filter(d => d.hour === h);
                return rows.reduce((sum, r) => sum + (r[level] || 0), 0);
            }),
            name: level,
            type: 'scatter',
            mode: 'lines',
            stackgroup: 'one',
            line: { color: THEME.colors[level] }
        };
    });
    Plotly.newPlot('hourly-traffic', traces, {
        ...layoutBase,
        xaxis: { ...layoutBase.xaxis, title: 'Hora del Día (UTC)' },
        yaxis: { ...layoutBase.yaxis, title: 'Acumulado Periodos' }
    }, {responsive: true});
}

// 9. Correlation Heatmap
function setupCorrHeatmap(data, airports) {
    const select = document.getElementById('corr-airport-select');
    airports.forEach(apt => select.add(new Option(apt, apt)));
    
    const render = (apt) => {
        const aptData = data.filter(d => d.airport === apt);
        if(!aptData.length) return;
        const vars = ['temperature', 'dewPoint', 'visibility', 'knots', 'height'];
        
        const z = vars.map(v1 => {
            const row = aptData.find(d => d.variable === v1);
            return vars.map(v2 => row ? row[v2] : 0);
        });

        const trace = {
            z: z,
            x: ['Temp', 'Dew Pt', 'Vis', 'Wind', 'Ceiling'],
            y: ['Temp', 'Dew Pt', 'Vis', 'Wind', 'Ceiling'],
            type: 'heatmap',
            colorscale: 'RdBu',
            zmin: -1,
            zmax: 1
        };
        Plotly.newPlot('corr-heatmap', [trace], { ...layoutBase, margin: {t:20, b:40, l:60, r:20}}, {responsive: true});
    };
    
    select.addEventListener('change', (e) => render(e.target.value));
    render(airports[0]);
}

// 10. Radar Bad Conditions
function plotRadarCond(data) {
    const vars = ['is_low_vis', 'is_high_wind', 'is_low_ceiling', 'has_rain', 'has_fog'];
    const labels = ['Baja Vis.', 'Viento Fuerte', 'Techo Bajo', 'Lluvia', 'Niebla'];
    
    const traces = data.map(aptRow => {
        // Normalize values slightly to fit radar well (or just plot raw counts)
        // Here we use raw counts
        return {
            type: 'scatterpolar',
            r: vars.map(v => aptRow[v]),
            theta: labels,
            fill: 'toself',
            name: aptRow.airport
        };
    });

    Plotly.newPlot('radar-cond', traces, {
        polar: {
            radialaxis: { visible: true, angle: 90, color: THEME.text_secondary, gridcolor: THEME.grid_color },
            angularaxis: { color: THEME.text_primary, gridcolor: THEME.grid_color },
            bgcolor: THEME.bg_card
        },
        plot_bgcolor: THEME.bg_card,
        paper_bgcolor: THEME.bg_card,
        font: { color: THEME.text_primary, family: 'Inter' }
    }, {responsive: true});
}

// Boot
window.onload = initDashboard;
