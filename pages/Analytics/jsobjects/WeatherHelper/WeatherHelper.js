export default {

    getData() {
        return fetch_analytics_data.data || [];
    },

    getMonthly() {

        const data = this.getData();
        const monthly = {};

        data.forEach(r => {

            const m = String(r.time_period);

            if (!monthly[m])
                monthly[m] = {
                    cdd: 0,
                    hdd: 0,
                    cons: 0,
                    cnt: 0
                };

            const cdd = parseFloat(r.total_cdd) || 0;
            const hdd = parseFloat(r.total_hdd) || 0;
            const cons = parseFloat(r.consumption) || 0;

            if (cdd > monthly[m].cdd) monthly[m].cdd = cdd;
            if (hdd > monthly[m].hdd) monthly[m].hdd = hdd;

            monthly[m].cons += cons;
            monthly[m].cnt++;

        });

        return monthly;

    },

    getMonths() {

        const monthly = this.getMonthly();

        return Object.keys(monthly)
            .sort((a, b) => new Date(a) - new Date(b));

    },

    pearson(x, y) {

        const n = x.length;
        if (n < 3) return 0;

        const mx = x.reduce((a, b) => a + b, 0) / n;
        const my = y.reduce((a, b) => a + b, 0) / n;

        let num = 0,
            dx2 = 0,
            dy2 = 0;

        for (let i = 0; i < n; i++) {

            const dx = x[i] - mx;
            const dy = y[i] - my;

            num += dx * dy;
            dx2 += dx * dx;
            dy2 += dy * dy;

        }

        const den = Math.sqrt(dx2 * dy2);

        return den === 0 ? 0 : num / den;

    },

    getTimeSeriesConfig() {

        const monthly = this.getMonthly();
        const months = this.getMonths();

        const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        const labels = months.map(m => {
            const p = m.split("-");
            return names[p[1] - 1] + " " + p[0];
        });

        return {

            backgroundColor: "#1E293B",

            tooltip: {
                trigger: "axis"
            },

            legend: {
                data: ["Total CDD", "Total HDD", "Average Consumption"],
                top: 6,
                textStyle: {
                    color: "#e5e7eb"
                }
            },

            grid: {
                left: "8%",
                right: "8%",
                bottom: "18%",
                top: "12%",
                containLabel: true
            },

            xAxis: {
                type: "category",
                data: labels,
                axisLabel: {
                    rotate: 40,
                    margin: 10,
                    color: "#d1d5db"
                },
                axisLine: {
                    show: false
                },
                axisTick: {
                    show: false
                }
            },

            yAxis: [{
                    type: "value",
                    name: "CDD & HDD",
                    nameTextStyle: {
                        color: "#e5e7eb"
                    },
                    axisLabel: {
                        color: "#d1d5db"
                    },
                    axisLine: {
                        show: false
                    },
                    axisTick: {
                        show: false
                    },
                    splitLine: {
                        lineStyle: {
                            color: "#374151"
                        }
                    }
                },
                {
                    type: "value",
                    name: "Avg Consumption",
                    nameTextStyle: {
                        color: "#e5e7eb"
                    },
                    axisLabel: {
                        color: "#d1d5db"
                    },
                    axisLine: {
                        show: false
                    },
                    axisTick: {
                        show: false
                    },
                    splitLine: {
                        show: false
                    }
                }
            ],

            series: [

                {
                    name: "Total CDD",
                    type: "bar",
                    stack: "dd",
                    barWidth: 22,
                    itemStyle: {
                        color: "#ef4444"
                    },
                    data: months.map(m => monthly[m].cdd)
                },

                {
                    name: "Total HDD",
                    type: "bar",
                    stack: "dd",
                    barWidth: 22,
                    itemStyle: {
                        color: "#3b82f6"
                    },
                    data: months.map(m => monthly[m].hdd)
                },

                {
                    name: "Average Consumption",
                    type: "line",
                    yAxisIndex: 1,
                    smooth: true,
                    symbolSize: 6,
                    lineStyle: {
                        color: "#ffffff",
                        width: 3
                    },
                    itemStyle: {
                        color: "#ffffff"
                    },
                    data: months.map(m =>
                        monthly[m].cnt > 0 ?
                        Number((monthly[m].cons / monthly[m].cnt).toFixed(2)) : 0
                    )
                }

            ]

        };

    },

    getCorrelationConfig() {

        const data = this.getData();
        const locMonthly = {};

        data.forEach(r => {

            const lid = r.location_id;
            const m = r.time_period;

            if (!locMonthly[lid])
                locMonthly[lid] = {
                    name: r.location_description,
                    months: {}
                };

            if (!locMonthly[lid].months[m])
                locMonthly[lid].months[m] = {
                    dd: 0,
                    cons: 0
                };

            locMonthly[lid].months[m].dd += parseFloat(r.total_dd) || 0;
            locMonthly[lid].months[m].cons += parseFloat(r.consumption) || 0;

        });

        const corrs = [];

        Object.values(locMonthly).forEach(l => {

            const dd = [];
            const cons = [];

            Object.values(l.months).forEach(m => {

                if (m.dd > 0 && m.cons > 0) {
                    dd.push(m.dd);
                    cons.push(m.cons);
                }

            });

            if (dd.length >= 3) {

                const corr = this.pearson(dd, cons);

                if (corr > 0) {

                    corrs.push({
                        name: l.name,
                        value: Number(corr.toFixed(2))
                    });

                }

            }

        });

        corrs.sort((a, b) => b.value - a.value);

        return {

            backgroundColor: "#1E293B",

            tooltip: {
                trigger: "axis"
            },

            grid: {
                left: "5%",
                right: "5%",
                bottom: "8%",
                top: "3%",
                containLabel: true
            },

            legend: {
                textStyle: {
                    color: "#e5e7eb"
                }
            },

            xAxis: {
                type: "value",
                min: 0,
                max: 1,
                axisLabel: {
                    color: "#d1d5db"
                },
                splitLine: {
                    lineStyle: {
                        color: "#374151"
                    }
                }
            },

            yAxis: {
                type: "category",
                inverse: true,
                data: corrs.map(c => c.name),
                axisLabel: {
                    color: "#d1d5db"
                }
            },

            series: [{
                type: "bar",
              	 barWidth:22,
                itemStyle: {
                    color: "#60a5fa"
                },
                data: corrs.map(c => c.value)
            }]

        };

    },

    getScatterConfig() {

        const data = this.getData();
        const locSeries = {};

        data.forEach(r => {

            const loc = r.location_description;

            if (!locSeries[loc]) locSeries[loc] = [];

            locSeries[loc].push([
                parseFloat(r.total_dd) || 0,
                parseFloat(r.consumption) || 0
            ]);

        });

        const colors = [
            '#60a5fa', '#1d4ed8', '#fbbf24', '#4ade80',
            '#059669', '#166534', '#6366f1', '#374151',
            '#ef4444', '#1e40af', '#f97316', '#a855f7',
            '#14b8a6', '#ec4899', '#84cc16', '#0ea5e9'
        ];

        let i = 0;

        const series = Object.keys(locSeries).map(name => {

            const s = {
                name: name,
                type: 'scatter',
                symbolSize: 6,
                itemStyle: {
                    color: colors[i % colors.length]
                },
                data: locSeries[name]
            };

            i++;

            return s;

        });

        return {

            backgroundColor: "#1E293B",

            tooltip: {
                trigger: 'item'
            },

            legend: {
                type: 'scroll',
                orient: 'vertical',
                right: 10,
                top: 10,
                height: 220,
                textStyle: {
                    color: "#e5e7eb"
                }
            },

            grid: {
                left: '10%',
                right: '20%',
                bottom: '10%',
                top: '10%'
            },

            xAxis: {
                type: 'value',
                name: 'Degree Days',
                nameGap: 18,
                axisLabel: {
                    color: "#d1d5db"
                },
                splitLine: {
                    lineStyle: {
                        color: "#374151"
                    }
                }
            },

            yAxis: {
                type: 'value',
                name: 'Consumption',
                axisLabel: {
                    color: "#d1d5db",
                    formatter: v => {
                        if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
                        if (v >= 1000) return (v / 1000).toFixed(0) + 'K';
                        return v;
                    }
                },
                splitLine: {
                    lineStyle: {
                        color: "#374151"
                    }
                }
            },

            series: series

        };

    },

    getTimeSeriesTable() {

        const monthly = this.getMonthly();
        const months = this.getMonths();

        return months.map(m => ({

            month: m,

            total_cdd: Number(monthly[m].cdd.toFixed(2)),

            total_hdd: Number(monthly[m].hdd.toFixed(2)),

            avg_consumption: monthly[m].cnt > 0 ?
                Number((monthly[m].cons / monthly[m].cnt).toFixed(2)) : 0

        }));

    },

    getCorrelationTable() {

        const data = this.getData();
        const locData = {};

        data.forEach(r => {

            const lid = r.location_id;

            if (!locData[lid])
                locData[lid] = {
                    name: r.location_description,
                    dd: [],
                    cons: []
                };

            locData[lid].dd.push(parseFloat(r.total_dd) || 0);
            locData[lid].cons.push(parseFloat(r.consumption) || 0);

        });

        const rows = [];

        Object.values(locData).forEach(l => {

            if (l.dd.length >= 3) {

                const corr = this.pearson(l.dd, l.cons);

                if (corr > 0) {

                    rows.push({
                        location: l.name,
                        correlation: Math.round(corr * 100) / 100
                    });

                }

            }

        });

        return rows.sort((a, b) => b.correlation - a.correlation);

    },

    getScatterTable() {

        return this.getData().map(r => ({

            location: r.location_description,
            degree_days: parseFloat(r.total_dd) || 0,
            consumption: parseFloat(r.consumption) || 0,
            month: r.time_period

        }));

    }

};