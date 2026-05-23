import os
import pandas as pd
import json
import numpy as np

# Configuration
BASE_DATA_DIR = "../DatosPreparados"
OUTPUT_DIR = "docs/data"
AIRPORTS = ["GCLP", "LEBL", "LEMD", "LEMG", "LEPA"]

SUNSHINE_HOURS = {
    'LEMD': [148, 165, 214, 231, 272, 310, 359, 335, 261, 198, 157, 124],
    'LEBL': [149, 163, 200, 220, 244, 262, 310, 282, 219, 180, 146, 138],
    'LEMG': [181, 180, 222, 244, 292, 329, 347, 316, 255, 215, 172, 160],
    'LEPA': [167, 170, 228, 237, 284, 314, 346, 316, 227, 205, 161, 151],
    'GCLP': [190, 194, 226, 227, 271, 283, 308, 298, 239, 219, 190, 192]
}

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
    df_merged['next_dateTime'] = pd.to_datetime(df_merged['next_dateTime'])
    df_merged['duration_hours'] = (df_merged['next_dateTime'] - df_merged['dateTime']).dt.total_seconds() / 3600
    df_merged.sort_values('dateTime', inplace=True)
    
    cols_to_ffill = ['visibility', 'temperature', 'dewPoint', 'direction', 'knots', 'amount', 'height', 'type']
    for col in cols_to_ffill:
        if col in df_merged.columns:
            df_merged[col] = df_merged[col].ffill()
            
    if 'amount' in df_merged.columns:
        df_merged['amount'] = df_merged['amount'].fillna('Despejado/CAVOK')
        
    if 'phenomenon1' in df_merged.columns:
        df_merged['phenomenon1'] = df_merged['phenomenon1'].fillna('Sin incidentes')
            
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
            final_df[col] = pd.to_numeric(final_df[col], errors='coerce').round(2)
            
    # Temporal attributes
    final_df['month'] = final_df['dateTime'].dt.month
    final_df['day'] = final_df['dateTime'].dt.day
    final_df['hour'] = final_df['dateTime'].dt.hour
    final_df['season'] = final_df['month'].apply(get_season)
    final_df['date'] = final_df['dateTime'].dt.date
    
    # Month Name mapping for JS
    month_names = {1:'Enero', 2:'Febrero', 3:'Marzo', 4:'Abril', 5:'Mayo', 6:'Junio', 
                   7:'Julio', 8:'Agosto', 9:'Septiembre', 10:'Octubre', 11:'Noviembre', 12:'Diciembre'}
    final_df['month_name'] = final_df['month'].map(month_names)

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    return final_df

def generate_json_payloads(df):
    print("Generating JSON payloads for dashboard...")
    
    # 3. Wind Rose (Added season filter)
    bins = np.linspace(0, 360, 9)
    labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
    df['wind_dir_cat'] = pd.cut(df['direction'], bins=bins, labels=labels, include_lowest=True)
    speed_bins = [0, 5, 10, 15, 20, 50]
    speed_labels = ['0-5', '5-10', '10-15', '15-20', '20+']
    df['wind_speed_cat'] = pd.cut(df['knots'], bins=speed_bins, labels=speed_labels, include_lowest=True)
    
    wind_rose = df.groupby(['airport', 'month_name', 'wind_dir_cat', 'wind_speed_cat'], observed=True).size().reset_index(name='count')
    wind_rose.to_json(os.path.join(OUTPUT_DIR, "wind_rose.json"), orient="records")
    
    # 4. Wind Gusts (Scatter)
    gusts_data = df[df['maxKnots'] > 0][['airport', 'date', 'hour', 'knots', 'maxKnots', 'volume_group']].dropna()
    gusts_data['date'] = gusts_data['date'].astype(str)
    if len(gusts_data) > 10000: gusts_data = gusts_data.sample(10000)
    gusts_data.to_json(os.path.join(OUTPUT_DIR, "wind_gusts.json"), orient="records")
    
    # 5. Visibility vs Traffic (Graph 4 Redesign)
    df['is_low_vis'] = df['visibility'] < 1000
    vis_traffic = df.groupby(['airport', 'date', 'month_name', 'hour', 'volume_group'], observed=True).agg(
        total=('is_low_vis', 'count'),
        low_vis_count=('is_low_vis', 'sum')
    ).reset_index()
    vis_traffic['date'] = vis_traffic['date'].astype(str)
    vis_traffic.to_json(os.path.join(OUTPUT_DIR, "visibility_vs_traffic.json"), orient="records")
    
    # 6. Cloud Amounts
    cloud_amounts = df.groupby(['airport', 'month_name', 'hour', 'amount'], observed=True).agg({'duration_hours': 'sum'}).reset_index()
    cloud_amounts.rename(columns={'duration_hours': 'count'}, inplace=True)
    cloud_amounts['count'] = cloud_amounts['count'].round(1)
    cloud_amounts.to_json(os.path.join(OUTPUT_DIR, "cloud_amounts.json"), orient="records")
    
    # 7. Monthly Evolution
    monthly_evo = df.groupby(['airport', 'date', 'hour'], observed=True).agg({
        'temperature': 'mean',
        'visibility': 'mean'
    }).reset_index()
    monthly_evo['date'] = monthly_evo['date'].astype(str)
    monthly_evo.to_json(os.path.join(OUTPUT_DIR, "monthly_evolution.json"), orient="records")

    # 8. Phenomena Distribution
    phenomena_cols = ['phenomenon1', 'phenomenon2', 'phenomenon3']
    all_phen = pd.melt(df, id_vars=['airport', 'date', 'duration_hours'], value_vars=phenomena_cols, value_name='phenomenon')
    all_phen = all_phen.dropna(subset=['phenomenon'])
    phen_dist = all_phen.groupby(['airport', 'date', 'phenomenon']).agg({'duration_hours': 'sum'}).reset_index()
    phen_dist.rename(columns={'duration_hours': 'count'}, inplace=True)
    phen_dist['count'] = phen_dist['count'].round(1)
    phen_dist['date'] = phen_dist['date'].astype(str)
    phen_dist.to_json(os.path.join(OUTPUT_DIR, "phenomena_distribution.json"), orient="records")

    # 9. Correlation Termodinámica -> 3D Scatter
    data_3d = df[['airport', 'date', 'hour', 'temperature', 'dewPoint', 'visibility']].dropna()
    data_3d['date'] = data_3d['date'].astype(str)
    # Removing sampling limit to allow dynamic JS time resolution grouping
    data_3d.to_json(os.path.join(OUTPUT_DIR, "3d_scatter_data.json"), orient="records")

    # 10. Risk Profile (Graph 8)
    df['is_high_wind'] = df['knots'] > 15
    df['is_low_ceiling'] = df['height'] < 500
    df['has_rain'] = df['phenomenon1'].str.contains('Lluvia', case=False, na=False) | df['phenomenon1'].str.contains('RA', na=False)
    df['has_fog'] = df['phenomenon1'].str.contains('Niebla', case=False, na=False) | df['phenomenon1'].str.contains('FG', na=False)
    radar_cond = df.groupby(['airport', 'date', 'hour']).agg({
        'is_low_vis': 'mean', 'is_high_wind': 'mean', 'is_low_ceiling': 'mean',
        'has_rain': 'mean', 'has_fog': 'mean'
    }).reset_index()
    radar_cond['date'] = radar_cond['date'].astype(str)
    radar_cond.to_json(os.path.join(OUTPUT_DIR, "radar_bad_conditions.json"), orient="records")

    # --- PHASE 3 NEW JSON PAYLOADS ---

    # 11. Climatological Summary Table (Gráfica 9)
    climate_summary = df.groupby(['airport', 'month']).agg({
        'temperature': ['mean', 'max', 'min']
    }).reset_index()
    climate_summary.columns = ['airport', 'month', 'mean_temp', 'max_temp', 'min_temp']
    
    days_phen = df.groupby(['airport', 'month', 'date']).agg({
        'phenomenon1': lambda x: ' '.join(x.dropna()),
        'phenomenon2': lambda x: ' '.join(x.dropna())
    }).reset_index()
    days_phen['all_phen'] = days_phen['phenomenon1'] + ' ' + days_phen['phenomenon2']
    
    days_phen['has_snow'] = days_phen['all_phen'].str.contains('Nieve|SN', case=False, na=False)
    days_phen['has_storm'] = days_phen['all_phen'].str.contains('Tormenta|TS', case=False, na=False)
    days_phen['has_frost'] = days_phen['all_phen'].str.contains('Congela|FZ', case=False, na=False)
    days_phen['has_fog'] = days_phen['all_phen'].str.contains('Niebla|FG', case=False, na=False)
    days_phen['has_rain'] = days_phen['all_phen'].str.contains('Lluvia|RA', case=False, na=False)

    monthly_phen = days_phen.groupby(['airport', 'month']).agg({
        'has_snow': 'sum', 'has_storm': 'sum', 'has_frost': 'sum', 
        'has_fog': 'sum', 'has_rain': 'sum'
    }).reset_index()

    climate_merged = pd.merge(climate_summary, monthly_phen, on=['airport', 'month'])
    
    def get_sunshine(row):
        return SUNSHINE_HOURS.get(row['airport'], [0]*12)[int(row['month'])-1]
    
    climate_merged['sunshine_hours'] = climate_merged.apply(get_sunshine, axis=1)
    climate_merged.to_json(os.path.join(OUTPUT_DIR, "climatological_summary.json"), orient="records")

    # 12. Hourly Temperature (Gráfica 10)
    hourly_temp = df.groupby(['airport', 'date', 'hour']).agg({
        'temperature': 'mean'
    }).reset_index()
    hourly_temp['date'] = hourly_temp['date'].astype(str)
    hourly_temp.to_json(os.path.join(OUTPUT_DIR, "hourly_temperature.json"), orient="records")

    # 13. Wind Direction Freq (Gráfica 11)
    dir_bins = np.linspace(5, 365, 13)
    dir_labels = ['01', '04', '07', '10', '13', '16', '19', '22', '25', '28', '31', '34']
    df['wind_30_deg'] = pd.cut(df['direction'], bins=dir_bins, labels=dir_labels, right=False)
    df.loc[df['direction'] >= 355, 'wind_30_deg'] = '01'
    df.loc[(df['direction'] >= 0) & (df['direction'] < 5), 'wind_30_deg'] = '01'

    df['wind_category'] = df['wind_30_deg'].astype(str)
    df.loc[df['knots'] == 0, 'wind_category'] = 'Calma'
    wind_freq = df.groupby(['airport', 'date', 'wind_category']).size().reset_index(name='count')
    wind_freq['date'] = wind_freq['date'].astype(str)
    wind_freq.to_json(os.path.join(OUTPUT_DIR, "wind_direction_freq.json"), orient="records")

    # 14. 3D Cloud Base Freq (Gráfica 12)
    def cloud_bin(h):
        if pd.isna(h): return None
        if h < 1: return '< 30m'
        elif h < 2: return '< 60m'
        elif h < 5: return '< 150m'
        elif h < 10: return '< 300m'
        else: return '> 300m'
    
    df['cloud_base_bin'] = df['height'].apply(cloud_bin)
    cloud_3d = df.groupby(['airport', 'date', 'hour', 'cloud_base_bin']).size().reset_index(name='count')
    cloud_3d['date'] = cloud_3d['date'].astype(str)
    cloud_3d.to_json(os.path.join(OUTPUT_DIR, "cloud_base_3d.json"), orient="records")

    # 15. 3D Visibility Freq (Gráfica 13)
    def vis_bin(v):
        if pd.isna(v): return None
        if v < 800: return '< 800m'
        elif v < 1500: return '< 1500m'
        elif v < 3000: return '< 3000m'
        elif v < 5000: return '< 5000m'
        else: return '> 5000m'
        
    df['vis_bin'] = df['visibility'].apply(vis_bin)
    vis_3d = df.groupby(['airport', 'date', 'hour', 'vis_bin']).size().reset_index(name='count')
    vis_3d['date'] = vis_3d['date'].astype(str)
    vis_3d.to_json(os.path.join(OUTPUT_DIR, "visibility_3d.json"), orient="records")

    # 16. RVR Sim Freq (Gráfica 14)
    def rvr_bin(v):
        if pd.isna(v): return None
        if v < 50: return '< 50m'
        elif v < 200: return '< 200m'
        elif v < 350: return '< 350m'
        elif v < 550: return '< 550m'
        elif v < 1500: return '< 1500m'
        else: return '> 1500m'
        
    df['rvr_bin'] = df['visibility'].apply(rvr_bin)
    rvr_3d = df.groupby(['airport', 'date', 'hour', 'rvr_bin']).size().reset_index(name='count')
    rvr_3d['date'] = rvr_3d['date'].astype(str)
    rvr_3d.to_json(os.path.join(OUTPUT_DIR, "rvr_sim_3d.json"), orient="records")

    # 17. Temp Intervals (Gráfica 15)
    temp_bins = [-100, -10, -6, -1, 4, 9, 14, 19, 24, 29, 34, 40, 100]
    temp_labels = ['<-10ºC', '-10/-6', '-5/-1', '0/4', '5/9', '10/14', '15/19', '20/24', '25/29', '30/34', '35/40', '>40ºC']
    df['temp_bin'] = pd.cut(df['temperature'], bins=temp_bins, labels=temp_labels)
    temp_stacked = df.groupby(['airport', 'date', 'hour', 'temp_bin'], observed=True).size().reset_index(name='count')
    temp_stacked['date'] = temp_stacked['date'].astype(str)
    temp_stacked.to_json(os.path.join(OUTPUT_DIR, "temp_intervals_freq.json"), orient="records")

    # 18. Phenomena Macro Freq (Gráfica 16)
    def categorize_phen(p):
        if pd.isna(p) or p == 'Sin incidentes' or p.strip() == '': return 'Sin incidentes'
        p = str(p).upper()
        if 'TS' in p or 'TORMENTA' in p:
            return 'Tormenta'
        if 'FG' in p or 'NIEBLA' in p or 'BR' in p or 'NEBLINA' in p or 'HZ' in p or 'BRUMA' in p:
            return 'Visibilidad'
        if 'RA' in p or 'LLUVIA' in p or 'SN' in p or 'NIEVE' in p or 'GR' in p or 'GS' in p or 'GRANIZO' in p:
            return 'Precipitación'
        return 'Otros'
        
    df['phen_combined'] = df['characteristic'].fillna('') + ' ' + df['phenomenon1'].fillna('') + ' ' + df['phenomenon2'].fillna('') + ' ' + df['phenomenon3'].fillna('')
    df['phen_macro'] = df['phen_combined'].apply(categorize_phen)
    phen_macro_freq = df.groupby(['airport', 'date', 'phen_macro']).agg({'duration_hours': 'sum'}).reset_index()
    phen_macro_freq.rename(columns={'duration_hours': 'count'}, inplace=True)
    phen_macro_freq['count'] = phen_macro_freq['count'].round(1)
    phen_macro_freq['date'] = phen_macro_freq['date'].astype(str)
    phen_macro_freq.to_json(os.path.join(OUTPUT_DIR, "phenomena_macro_freq.json"), orient="records")

    print("Phase 3 JSON payloads generated successfully.")

def generate_ai_context():
    context = {
        "project_context": "Análisis meteorológico avanzado. Fase 3 implementada con 16 representaciones totales.",
        "insights": ["Se incorporaron vistas tridimensionales temporales y análisis térmicos de alta resolución."]
    }
    with open(os.path.join(OUTPUT_DIR, "report_ai_context.json"), "w", encoding="utf-8") as f:
        json.dump(context, f, indent=4, ensure_ascii=False)

if __name__ == "__main__":
    df_all = process_all_airports()
    generate_json_payloads(df_all)
    generate_ai_context()
    print("Data Pipeline Completed.")
