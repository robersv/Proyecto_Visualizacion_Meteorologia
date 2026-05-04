import os
import pandas as pd
import json
import numpy as np

# Configuration
BASE_DATA_DIR = "../DatosPreparados"
OUTPUT_DIR = "docs/data"
AIRPORTS = ["GCLP", "LEBL", "LEMD", "LEMG", "LEPA"]

def get_season(month):
    if month in [12, 1, 2]: return 'DJF (Invierno)'
    elif month in [3, 4, 5]: return 'MAM (Primavera)'
    elif month in [6, 7, 8]: return 'JJA (Verano)'
    else: return 'SON (Otoño)'

def load_and_merge_airport_data(airport_code):
    print(f"Processing {airport_code}...")
    dir_path = os.path.join(BASE_DATA_DIR, airport_code)
    try:
        df_clouds = pd.read_csv(os.path.join(dir_path, "Clouds.csv"), sep=';', na_values='NULL', low_memory=False)
        df_misc = pd.read_csv(os.path.join(dir_path, "Miscellaneous.csv"), sep=';', na_values='NULL', low_memory=False)
        df_phen = pd.read_csv(os.path.join(dir_path, "Phenomena.csv"), sep=';', na_values='NULL', low_memory=False)
    except FileNotFoundError as e:
        print(f"Error loading data for {airport_code}: {e}")
        return None

    common_cols = ['dateTime', 'next_dateTime', 'arr_volume_group', 'dep_volume_group', 'volume_group', 'metarKey']
    df_merged = pd.merge(df_clouds, df_misc, on=common_cols, how='outer')
    df_merged = pd.merge(df_merged, df_phen, on=common_cols, how='outer')
    
    df_merged['airport'] = airport_code
    df_merged['dateTime'] = pd.to_datetime(df_merged['dateTime'])
    df_merged.sort_values('dateTime', inplace=True)
    
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
    
    if not all_dfs: raise ValueError("No data loaded!")
    final_df = pd.concat(all_dfs, ignore_index=True)
    
    # Cleaning
    for col in ['visibility', 'temperature', 'dewPoint', 'knots', 'direction', 'height', 'maxKnots', 'gustyWind']:
        if col in final_df.columns:
            final_df[col] = pd.to_numeric(final_df[col], errors='coerce')
            
    # Temporal attributes
    final_df['month'] = final_df['dateTime'].dt.month
    final_df['day'] = final_df['dateTime'].dt.day
    final_df['hour'] = final_df['dateTime'].dt.hour
    final_df['season'] = final_df['month'].apply(get_season)
    
    # Month Name mapping for JS
    month_names = {1:'Enero', 2:'Febrero', 3:'Marzo', 4:'Abril', 5:'Mayo', 6:'Junio', 
                   7:'Julio', 8:'Agosto', 9:'Septiembre', 10:'Octubre', 11:'Noviembre', 12:'Diciembre'}
    final_df['month_name'] = final_df['month'].map(month_names)

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    return final_df

def generate_json_payloads(df):
    print("Generating JSON payloads for dashboard...")
    
    # (Traffic dist and Hourly traffic were removed per user request)
    
    # 3. Wind Rose (Added season filter)
    bins = np.linspace(0, 360, 9)
    labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
    df['wind_dir_cat'] = pd.cut(df['direction'], bins=bins, labels=labels, include_lowest=True)
    speed_bins = [0, 5, 10, 15, 20, 50]
    speed_labels = ['0-5', '5-10', '10-15', '15-20', '20+']
    df['wind_speed_cat'] = pd.cut(df['knots'], bins=speed_bins, labels=speed_labels, include_lowest=True)
    
    wind_rose = df.groupby(['airport', 'season', 'wind_dir_cat', 'wind_speed_cat'], observed=True).size().reset_index(name='count')
    wind_rose.to_json(os.path.join(OUTPUT_DIR, "wind_rose.json"), orient="records")
    
    # 4. Wind Gusts (Scatter) -> Fix: We ensured knots/maxKnots are numeric. 
    gusts_data = df[df['maxKnots'] > 0][['airport', 'knots', 'maxKnots', 'volume_group']].dropna()
    if len(gusts_data) > 10000: gusts_data = gusts_data.sample(10000)
    gusts_data.to_json(os.path.join(OUTPUT_DIR, "wind_gusts.json"), orient="records")
    
    # 5. Visibility vs Traffic (Replaced boxplot with Low Visibility Incidence)
    df['is_low_vis'] = df['visibility'] < 1000
    vis_traffic = df.groupby(['airport', 'volume_group']).agg(
        total=('is_low_vis', 'count'),
        low_vis_count=('is_low_vis', 'sum')
    ).reset_index()
    vis_traffic['low_vis_pct'] = (vis_traffic['low_vis_count'] / vis_traffic['total']) * 100
    vis_traffic.to_json(os.path.join(OUTPUT_DIR, "visibility_vs_traffic.json"), orient="records")
    
    # 6. Cloud Amounts (Added day and month filtering)
    cloud_amounts = df.groupby(['airport', 'month_name', 'day', 'amount'], observed=True).size().reset_index(name='count')
    cloud_amounts.to_json(os.path.join(OUTPUT_DIR, "cloud_amounts.json"), orient="records")
    
    # 7. Monthly Evolution (Now daily evolution with month filter)
    monthly_evo = df.groupby(['airport', 'month_name', 'day'], observed=True).agg({
        'temperature': 'mean',
        'visibility': 'mean'
    }).reset_index()
    monthly_evo.to_json(os.path.join(OUTPUT_DIR, "monthly_evolution.json"), orient="records")

    # 8. Phenomena Distribution (Donut Chart)
    phenomena_cols = ['phenomenon1', 'phenomenon2', 'phenomenon3']
    all_phen = pd.melt(df, id_vars=['airport'], value_vars=phenomena_cols, value_name='phenomenon')
    all_phen = all_phen.dropna(subset=['phenomenon'])
    phen_dist = all_phen.groupby(['airport', 'phenomenon']).size().reset_index(name='count')
    phen_dist.to_json(os.path.join(OUTPUT_DIR, "phenomena_distribution.json"), orient="records")

    # 9. Correlation Termodinámica -> 3D Scatter (Temp, Dew Pt, Visibility, colored by month)
    data_3d = df[['airport', 'temperature', 'dewPoint', 'visibility', 'month_name']].dropna()
    if len(data_3d) > 3000:
        data_3d = data_3d.sample(3000) # Limit for 3D performance
    data_3d.to_json(os.path.join(OUTPUT_DIR, "3d_scatter_data.json"), orient="records")

    # 10. Radar Bad Conditions (normalized)
    df['is_low_vis'] = df['visibility'] < 1000
    df['is_high_wind'] = df['knots'] > 15
    df['is_low_ceiling'] = df['height'] < 500
    df['has_rain'] = df['phenomenon1'].str.contains('Lluvia', case=False, na=False) | df['phenomenon1'].str.contains('RA', na=False)
    df['has_fog'] = df['phenomenon1'].str.contains('Niebla', case=False, na=False) | df['phenomenon1'].str.contains('FG', na=False)
    
    # Total records per airport to calculate percentage
    radar_cond = df.groupby('airport').agg({
        'is_low_vis': 'mean',
        'is_high_wind': 'mean',
        'is_low_ceiling': 'mean',
        'has_rain': 'mean',
        'has_fog': 'mean'
    }).reset_index()
    radar_cond.to_json(os.path.join(OUTPUT_DIR, "radar_bad_conditions.json"), orient="records")

    print("JSON payloads generated successfully.")

def generate_ai_context():
    context = {
        "project_context": "Análisis meteorológico de 5 aeropuertos españoles. Se han aplicado filtros estacionales y métricas normalizadas.",
        "insights": ["Se ha reemplazado la visibilidad estática por probabilidad de eventos LVP (Baja visibilidad) cruzados con el tráfico."]
    }
    with open(os.path.join(OUTPUT_DIR, "report_ai_context.json"), "w", encoding="utf-8") as f:
        json.dump(context, f, indent=4, ensure_ascii=False)

if __name__ == "__main__":
    df_all = process_all_airports()
    generate_json_payloads(df_all)
    generate_ai_context()
    print("Data Pipeline Completed.")
