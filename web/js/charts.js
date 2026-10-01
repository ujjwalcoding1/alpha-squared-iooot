/**
 * Alpha Squared - Interactive Vitals Trend Charts Module (Chart.js)
 */

let hrChart = null;
let spo2Chart = null;
let tempChart = null;

const MAX_CHART_POINTS = 15;

const chartConfigBase = {
    type: 'line',
    options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false }
        },
        scales: {
            x: {
                grid: { color: 'rgba(255, 255, 255, 0.05)' },
                ticks: { color: '#94a3b8', font: { size: 10 } }
            },
            y: {
                grid: { color: 'rgba(255, 255, 255, 0.08)' },
                ticks: { color: '#94a3b8', font: { size: 10 } }
            }
        },
        animation: { duration: 400 }
    }
};

function initVitalsCharts() {
    if (typeof Chart === 'undefined') {
        console.warn("[Charts] Chart.js CDN not loaded.");
        return;
    }

    // 1. Heart Rate Chart
    const hrCtx = document.getElementById("chart-heart-rate")?.getContext("2d");
    if (hrCtx && !hrChart) {
        hrChart = new Chart(hrCtx, {
            ...chartConfigBase,
            data: {
                labels: [],
                datasets: [{
                    label: 'Heart Rate (BPM)',
                    data: [],
                    borderColor: '#06b6d4',
                    backgroundColor: 'rgba(6, 182, 212, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3
                }]
            }
        });
    }

    // 2. SpO2 Chart
    const spo2Ctx = document.getElementById("chart-spo2")?.getContext("2d");
    if (spo2Ctx && !spo2Chart) {
        spo2Chart = new Chart(spo2Ctx, {
            ...chartConfigBase,
            data: {
                labels: [],
                datasets: [{
                    label: 'SpO2 (%)',
                    data: [],
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3
                }]
            }
        });
    }

    // 3. Temperature Chart
    const tempCtx = document.getElementById("chart-temperature")?.getContext("2d");
    if (tempCtx && !tempChart) {
        tempChart = new Chart(tempCtx, {
            ...chartConfigBase,
            data: {
                labels: [],
                datasets: [{
                    label: 'Temperature (°C)',
                    data: [],
                    borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3
                }]
            }
        });
    }
}

function pushChartDataPoint(timestampLabel, heartRate, spo2, temp) {
    if (!hrChart || !spo2Chart || !tempChart) return;

    // Heart Rate
    hrChart.data.labels.push(timestampLabel);
    hrChart.data.datasets[0].data.push(heartRate);
    if (hrChart.data.labels.length > MAX_CHART_POINTS) {
        hrChart.data.labels.shift();
        hrChart.data.datasets[0].data.shift();
    }
    hrChart.update();

    // SpO2
    spo2Chart.data.labels.push(timestampLabel);
    spo2Chart.data.datasets[0].data.push(spo2);
    if (spo2Chart.data.labels.length > MAX_CHART_POINTS) {
        spo2Chart.data.labels.shift();
        spo2Chart.data.datasets[0].data.shift();
    }
    spo2Chart.update();

    // Temperature
    tempChart.data.labels.push(timestampLabel);
    tempChart.data.datasets[0].data.push(temp);
    if (tempChart.data.labels.length > MAX_CHART_POINTS) {
        tempChart.data.labels.shift();
        tempChart.data.datasets[0].data.shift();
    }
    tempChart.update();
}
