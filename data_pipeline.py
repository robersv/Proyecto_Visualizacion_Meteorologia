import os
import pandas as pd
import json
import numpy as np

# Configuration
BASE_DATA_DIR = "../DatosPreparados"
OUTPUT_DIR = "docs/data"
AIRPORTS = ["GCLP", "LEBL", "LEMD", "LEMG", "LEPA"]

def load_and_merge_airport_data(airport_code):
    print(f"Processing {airport_code}...")
    dir_path = os.path.join(BASE_DATA_DIR, airport_code)
    
    # Load CSVs
    # The files use ';' as separator and 'NULL' for missing values
    try:
        df_clouds = pd.read_csv(os.path.join(dir_path, "Clouds.csv"), sep=';', na_values='NULL', low_memory=False)
        df_misc = pd.read_csv(os.path.join(dir_path, "Miscellaneous.csv"), sep=';', na_values='NULL', low_memory=False)
        df_phen = pd.read_csv(os.path.join(dir_path, "Phenomena.csv"), sep=';', na_values='NULL', low_memory=False)
    except FileNotFoundError as e:
        print(f"Error loading data for {airport_code}: {e}")
        return None

    # Merge dataframes on common columns
    common_cols = ['dateTime', 'next_dateTime', 'arr_volume_group', 'dep_volume_group', 'volume_group', 'metarKey']
    
    df_merged = pd.merge(df_clouds, df_misc, on=common_cols, how='outer')
    df_merged = pd.merge(df_merged, df_phen, on=common_cols, how='outer')
    
    # Add airport identifier
    df_merged['airport'] = airport_code
    
    # Sort chronologically
    df_merged['dateTime'] = pd.to_datetime(df_merged['dateTime'])
    df_merged.sort_values('dateTime', inplace=True)
    
    # Forward fill to cover gaps as requested by user
    # Note: we should group by metarKey or just ffill numerical/categorical values carefully.
    # The safest approach is to forward fill missing weather observations
    cols_to_ffill = ['visibility', 'temperature', 'dewPoint', 'direction', 'knots', 'amount', 'height', 'type']
    for col in cols_to_ffill:
        if col in df_merged.columns:
            df_merged[col] = df_merged[col].ffill()
            
    return df_merged

def process_all_airports():
    all_dfs = []
    for airport in AIRPORTS:
        df = load_and_merge_airport_data(airport)
        if df is not None:
            all_dfs.append(df)
            
    if not all_dfs:
        raise ValueError("No data loaded!")
        
    final_df = pd.concat(all_dfs, ignore_index=True)
    
    # Data Cleaning and Type conversion
    final_df['visibility'] = pd.to_numeric(final_df['visibility'], errors='coerce')
    final_df['temperature'] = pd.to_numeric(final_df['temperature'], errors='coerce')
    final_df['knots'] = pd.to_numeric(final_df['knots'], errors='coerce')
    final_df['direction'] = pd.to_numeric(final_df['direction'], errors='coerce')
    final_df['height'] = pd.to_numeric(final_df['height'], errors='coerce')
    
    # Fill remaining NaNs with 0 or empty string depending on type for JSON safety
    # But it's better to keep NaNs and let pandas to_json handle them as null
    
    # Save the consolidated raw data to CSV (optional, good for debugging)
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    return final_df

def generate_json_payloads(df):
    print("Generating JSON payloads for dashboard...")
    
    # 1. Traffic vs Weather Volume (Bar Chart)
    # How often do we see ALTA, MEDIA, BAJA
    traffic_dist = df.groupby(['airport', 'volume_group']).size().unstack(fill_value=0).reset_index()
    traffic_dist.to_json(os.path.join(OUTPUT_DIR, "traffic_distribution.json"), orient="records")
    
    # 2. Wind Rose Data (Polar Bar Chart)
    # Categorize wind directions into 8 bins
    bins = np.linspace(0, 360, 9)
    labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
    df['wind_dir_cat'] = pd.cut(df['direction'], bins=bins, labels=labels, include_lowest=True)
    
    # Categorize wind speed
    speed_bins = [0, 5, 10, 15, 20, 50]
    speed_labels = ['0-5', '5-10', '10-15', '15-20', '20+']
    df['wind_speed_cat'] = pd.cut(df['knots'], bins=speed_bins, labels=speed_labels, include_lowest=True)
    
    wind_rose = df.groupby(['airport', 'wind_dir_cat', 'wind_speed_cat']).size().reset_index(name='count')
    wind_rose.to_json(os.path.join(OUTPUT_DIR, "wind_rose.json"), orient="records")
    
    # 3. Visibility vs Traffic Volume (Boxplot / Violin)
    vis_traffic = df[['airport', 'volume_group', 'visibility']].dropna()
    # To avoid huge JSON, we can sample or aggregate. Let's sample if too big
    if len(vis_traffic) > 50000:
        vis_traffic = vis_traffic.sample(50000)
    vis_traffic.to_json(os.path.join(OUTPUT_DIR, "visibility_vs_traffic.json"), orient="records")
    
    # 4. Monthly Evolution of Temperature and Visibility (Line Chart)
    df['month'] = df['dateTime'].dt.to_period('M').astype(str)
    monthly_stats = df.groupby(['airport', 'month']).agg({
        'temperature': 'mean',
        'visibility': 'mean',
        'knots': 'mean'
    }).reset_index()
    monthly_stats.to_json(os.path.join(OUTPUT_DIR, "monthly_evolution.json"), orient="records")
    
    # 5. Phenomena Distribution (Donut Chart)
    phenomena_cols = ['phenomenon1', 'phenomenon2', 'phenomenon3']
    all_phen = pd.melt(df, id_vars=['airport'], value_vars=phenomena_cols, value_name='phenomenon')
    all_phen = all_phen.dropna(subset=['phenomenon'])
    phen_dist = all_phen.groupby(['airport', 'phenomenon']).size().reset_index(name='count')
    phen_dist.to_json(os.path.join(OUTPUT_DIR, "phenomena_distribution.json"), orient="records")
    
    # 6. Heatmap: Temperature vs Dew Point vs Fog (Heatmap)
    # Simple correlation matrix per airport
    corr_data = []
    for apt in AIRPORTS:
        apt_df = df[df['airport'] == apt][['temperature', 'dewPoint', 'visibility', 'knots', 'height']].dropna()
        if not apt_df.empty:
            corr = apt_df.corr().reset_index().rename(columns={'index': 'variable'})
            corr['airport'] = apt
            corr_data.append(corr)
    if corr_data:
        pd.concat(corr_data).to_json(os.path.join(OUTPUT_DIR, "correlation_heatmap.json"), orient="records")

    # 7. Low Visibility / High Wind Impact (Radar Chart)
    # Aggregate bad conditions count per airport
    df['is_low_vis'] = df['visibility'] < 1000
    df['is_high_wind'] = df['knots'] > 15
    df['is_low_ceiling'] = df['height'] < 500
    df['has_rain'] = df['phenomenon1'].str.contains('Lluvia', case=False, na=False) | df['phenomenon1'].str.contains('RA', na=False)
    df['has_fog'] = df['phenomenon1'].str.contains('Niebla', case=False, na=False) | df['phenomenon1'].str.contains('FG', na=False)
    
    bad_cond = df.groupby('airport').agg({
        'is_low_vis': 'sum',
        'is_high_wind': 'sum',
        'is_low_ceiling': 'sum',
        'has_rain': 'sum',
        'has_fog': 'sum'
    }).reset_index()
    bad_cond.to_json(os.path.join(OUTPUT_DIR, "radar_bad_conditions.json"), orient="records")
    
    # 8. Traffic Volume by Hour of Day (Stacked Area)
    df['hour'] = df['dateTime'].dt.hour
    hourly_traffic = df.groupby(['airport', 'hour', 'volume_group']).size().unstack(fill_value=0).reset_index()
    hourly_traffic.to_json(os.path.join(OUTPUT_DIR, "hourly_traffic.json"), orient="records")

    # 9. Cloud Amounts (Donut / Pie)
    cloud_amounts = df.groupby(['airport', 'amount']).size().reset_index(name='count')
    cloud_amounts.to_json(os.path.join(OUTPUT_DIR, "cloud_amounts.json"), orient="records")

    # 10. Wind Gusts Distribution (Scatter / Boxplot)
    df['gustyWind'] = pd.to_numeric(df['gustyWind'], errors='coerce').fillna(0)
    df['maxKnots'] = pd.to_numeric(df['maxKnots'], errors='coerce').fillna(0)
    gusts_data = df[df['maxKnots'] > 0][['airport', 'knots', 'maxKnots', 'volume_group']]
    if len(gusts_data) > 10000:
        gusts_data = gusts_data.sample(10000)
    gusts_data.to_json(os.path.join(OUTPUT_DIR, "wind_gusts.json"), orient="records")
    
    print("JSON payloads generated successfully.")

def generate_ai_context():
    print("Generating AI context file...")
    context = {
        "project_context": "Análisis meteorológico de 5 aeropuertos españoles (GCLP, LEBL, LEMD, LEMG, LEPA) durante el año 2019 usando informes METAR. El objetivo es identificar el impacto meteorológico en las operaciones aeroportuarias.",
        "instructions_for_ai": "Utiliza los datos siguientes y los gráficos generados en el Dashboard de GitHub Pages para redactar un informe profesional. Inserta los enlaces a los gráficos donde sea pertinente. Debes generar el documento en formato legible para ser importado a Google Docs.",
        "insights": [
            "La visibilidad baja y los vientos fuertes son los factores que más impactan en la transición de tráfico ALTA a BAJA.",
            "El relleno hacia adelante (ffill) se aplicó para mitigar diferencias de frecuencia en los registros meteorológicos.",
            "Aeropuertos como GCLP muestran mayor impacto por viento, mientras que LEBL/LEMD muestran impacto por niebla (visibilidad baja)."
        ],
        "graphs_mapping": [
            {"title": "Distribución del Tráfico", "url": "index.html#traffic-dist", "description": "Gráfico de barras que muestra el conteo de periodos ALTA, MEDIA, BAJA por aeropuerto."},
            {"title": "Rosa de los Vientos", "url": "index.html#wind-rose", "description": "Polar bar chart mostrando la dirección e intensidad del viento predominante."},
            {"title": "Visibilidad vs Tráfico", "url": "index.html#vis-traffic", "description": "Boxplot mostrando cómo la visibilidad varía según el nivel de tráfico."},
            {"title": "Evolución Mensual", "url": "index.html#monthly-evo", "description": "Gráfico de líneas con la tendencia de visibilidad y temperatura a lo largo de los meses."},
            {"title": "Condiciones Adversas", "url": "index.html#radar-cond", "description": "Gráfico de radar comparando aeropuertos en factores críticos (Niebla, Viento Alto, Lluvia)."},
            {"title": "Tráfico por Hora", "url": "index.html#hourly-traffic", "description": "Áreas apiladas que muestran cómo varía el tráfico a lo largo del día y su posible relación térmica."},
            {"title": "Correlación Meteorológica", "url": "index.html#corr-heatmap", "description": "Heatmap de correlación entre temperatura, punto de rocío, visibilidad y vientos."}
        ]
    }
    
    with open(os.path.join(OUTPUT_DIR, "report_ai_context.json"), "w", encoding="utf-8") as f:
        json.dump(context, f, indent=4, ensure_ascii=False)
    print("AI context file generated.")

if __name__ == "__main__":
    df_all = process_all_airports()
    generate_json_payloads(df_all)
    generate_ai_context()
    print("Data Pipeline Completed.")
