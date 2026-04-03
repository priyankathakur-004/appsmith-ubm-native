export default {

/* ===============================
   ACTIVE SETTINGS
=============================== */

getActiveView(){
    return appsmith.store.ecActiveView || "AggregatedConsumption";
},

getUOMLabel(){

    const u = appsmith.store.ecUOM || "BTU";

    if(u==="Wh") return "Watt hour";
    if(u==="Joule") return "Joule";

    return "mmBTU";
},

	getLeftChartTitle() {
        const view = this.getActiveView();
        const uom = this.getUOMLabel();
        const titles = {
            'AggregatedConsumption': 'Aggregated energy consumption by location',
            'AggregatedUnitCost': 'Aggregated unit cost by location',
            'EnergyUseIntensity': 'Energy use intensity by location'
        };
        return titles[view] || titles['AggregatedConsumption'];
    },

    getRightChartTitle() {
        const view = this.getActiveView();
        const titles = {
            'AggregatedConsumption': 'Aggregated energy consumption by location, account number, meter',
            'AggregatedUnitCost': 'Aggregated unit cost by location, account number, meter',
            'EnergyUseIntensity': 'Energy use intensity by location, account number, meter'
        };
        return titles[view] || titles['AggregatedConsumption'];
    },

convertMMBTU(v){

    const u = appsmith.store.ecUOM || "BTU";

    if(u==="Wh") return v*293071;
    if(u==="Joule") return v*1055060000;

    return v;
},



/* ===============================
   UNIT CONVERSION (MASTER LOGIC)
=============================== */

getMMBTU(r){

    let factor=0;

    const unit=(r.total_consumption_uom||"").toUpperCase();

    if(unit==="KWH") factor=3412.14;
    else if(unit==="THERM") factor=100000;
    else if(unit==="CCF") factor=102800;
    else if(unit==="GAL") factor=138500;

    return ((Number(r.consumption)||0)*factor)/1000000;

},



/* ===============================
   AGGREGATED DATA
=============================== */

getLocationAggregatedData(){

    const raw=fetch_analytics_data.data||[];
    const map={};

    raw.forEach(r=>{

        const loc=r.location_description||"Unknown";

        if(!map[loc]){

            map[loc]={

                cons:0,
                charges:0,
                sqft:Number(r.square_feet)||0

            };
        }

        const mmBTU=this.getMMBTU(r);

        map[loc].cons+=mmBTU;
        map[loc].charges+=Number(r.total_charges)||0;

    });

    return map;
},



getMeterAggregatedData(){

    const raw=fetch_analytics_data.data||[];
    const map={};

    raw.forEach(r=>{

        const key=
        (r.location_description||"Unknown")
        +", "+
        (r.service_account||"-")
        +", "+
        (r.meter||"-");


        if(!map[key]){

            map[key]={

                cons:0,
                charges:0,
                sqft:Number(r.square_feet)||0

            };
        }

        const mmBTU=this.getMMBTU(r);

        map[key].cons+=mmBTU;
        map[key].charges+=Number(r.total_charges)||0;

    });

    return map;
},



getUtilityAggregatedData(){

    const raw=fetch_analytics_data.data||[];
    const map={};

    raw.forEach(r=>{

        const t=r.utility_type||"Unknown";

        if(!map[t]) map[t]=0;

        map[t]+=this.getMMBTU(r);

    });

    return map;
},



/* ===============================
   VALUE CALCULATION
=============================== */

getValue(d){

    const view=this.getActiveView();

    let v=d.cons;

    if(view==="AggregatedUnitCost")
        v=d.charges;

    if(view==="EnergyUseIntensity")
        v=d.sqft>0?d.cons/d.sqft:0;


    if(view!=="AggregatedUnitCost")
        v=this.convertMMBTU(v);


    return Number(v.toFixed(2));
},



/* ===============================
   LOCATION CHART
=============================== */

getLocationChartConfig(){

    const data=this.getLocationAggregatedData();
    const view=this.getActiveView();
    const uom=this.getUOMLabel();


    const rows=Object.entries(data)
    .map(([n,d])=>({

        name:n,
        value:this.getValue(d)

    }))
    .sort((a,b)=>b.value-a.value);



    let xlabel="Equivalent Energy ("+uom+")";

    if(view==="AggregatedUnitCost")
        xlabel="Total Charges ($)";

    if(view==="EnergyUseIntensity")
        xlabel="EUI ("+uom+"/sqft)";


    return{

        backgroundColor:"#1E293B",

        grid:{
            left:"15%",
            right:"10%",
            top:"5%",
            bottom:"10%"
        },


        xAxis:{
            type:"value",
            name:xlabel,
            nameLocation:"middle",
            nameGap:40,

            nameTextStyle:{color:"#CBD5E1"},

            axisLabel:{color:"#CBD5E1"},

            axisLine:{lineStyle:{color:"#475569"}},

            splitLine:{lineStyle:{color:"#334155"}}

        },


        yAxis:{
            type:"category",
            inverse:true,
            data:rows.map(r=>r.name),

            axisLabel:{
                color:"#E2E8F0",
                width:120,
                overflow:"truncate"
            },

            axisLine:{show:false},
            axisTick:{show:false}

        },


        series:[{

            type:"bar",
            barWidth:18,

            itemStyle:{
                color:"#3B82F6",
                borderRadius:[0,4,4,0]
            },

            data:rows.map(r=>r.value)

        }]

    };

},



/* ===============================
   METER CHART
=============================== */

getMeterChartConfig(){

    const data=this.getMeterAggregatedData();
    const view=this.getActiveView();
    const uom=this.getUOMLabel();


    const rows=Object.entries(data)
    .map(([n,d])=>({

        name:n.length>40?n.substring(0,37)+"...":n,
        value:this.getValue(d)

    }))
    .sort((a,b)=>b.value-a.value)
    .slice(0,8);



    let xlabel="Equivalent Energy ("+uom+")";

    if(view==="AggregatedUnitCost")
        xlabel="Total Charges ($)";

    if(view==="EnergyUseIntensity")
        xlabel="EUI ("+uom+"/sqft)";



    return{

        backgroundColor:"#1E293B",

        grid:{
            left:"40%",
            right:"5%",
            top:"5%",
            bottom:"10%"
        },


        xAxis:{
            type:"value",
            name:xlabel,
            nameLocation:"middle",
            nameGap:40,

            nameTextStyle:{color:"#CBD5E1"},

            axisLabel:{color:"#CBD5E1"},

            axisLine:{lineStyle:{color:"#475569"}},

            splitLine:{lineStyle:{color:"#334155"}}

        },


        yAxis:{
            type:"category",
            inverse:true,
            data:rows.map(r=>r.name),

            axisLabel:{
                color:"#E2E8F0",
                width:200,
                overflow:"truncate"
            },

            axisLine:{show:false},
            axisTick:{show:false}

        },


        series:[{

            type:"bar",
            barWidth:18,

            itemStyle:{
                color:"#3B82F6",
                borderRadius:[0,4,4,0]
            },

            data:rows.map(r=>r.value)

        }]

    };

},



/* ===============================
   PIE CHART
=============================== */

getUtilityPieConfig(){

    const data=this.getUtilityAggregatedData();


    const rows=Object.entries(data)
    .map(([n,v])=>({

        name:n,
        value:Number(this.convertMMBTU(v).toFixed(2))

    }));


    return{

        backgroundColor:"#1E293B",

        legend:{
            top:"3%",
            left:"center",
            textStyle:{color:"#E2E8F0"}
        },


        series:[{

            type:"pie",

            radius:["50%","70%"],

            center:["50%","55%"],

            label:{
                color:"#E2E8F0",
                formatter:p=>
                p.value+" ("+p.percent.toFixed(1)+"%)"
            },

            data:rows

        }]

    };

},



/* ===============================
   TABLES
=============================== */

getLocationTable(){

    const data=this.getLocationAggregatedData();
    const view=this.getActiveView();
    const uom=this.getUOMLabel();


    return Object.entries(data)
    .map(([n,d])=>({

        Location:n,
        Value:this.getValue(d),

        UOM:
        view==="AggregatedUnitCost"?"$":
        view==="EnergyUseIntensity"?uom+"/sqft":
        uom

    }))
    .sort((a,b)=>b.Value-a.Value);

},



getMeterTable(){

    const data=this.getMeterAggregatedData();
    const view=this.getActiveView();
    const uom=this.getUOMLabel();


    return Object.entries(data)
    .map(([n,d])=>({

        Meter:n,
        Value:this.getValue(d),

        UOM:
        view==="AggregatedUnitCost"?"$":
        view==="EnergyUseIntensity"?uom+"/sqft":
        uom

    }))
    .sort((a,b)=>b.Value-a.Value);

},



getUtilityTable(){

    const data=this.getUtilityAggregatedData();
    const uom=this.getUOMLabel();


    return Object.entries(data)
    .map(([n,v])=>({

        Utility:n,
        Value:Number(this.convertMMBTU(v).toFixed(2)),
        UOM:uom

    }))
    .sort((a,b)=>b.Value-a.Value);

},



/* ===============================
   DEFAULTS
=============================== */

setDefaults(){

    if(!appsmith.store.ecActiveView)
        storeValue("ecActiveView","AggregatedConsumption");

    if(!appsmith.store.ecUOM)
        storeValue("ecUOM","BTU");

}

};
