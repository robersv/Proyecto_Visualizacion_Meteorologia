import pandas as pd
import os

dir_path = "../DatosPreparados/GCLP"
df_phen = pd.read_csv(os.path.join(dir_path, "Phenomena.csv"), sep=';', na_values='NULL', low_memory=False)
print("Columnas:", df_phen.columns.tolist())
print(df_phen[['dateTime', 'next_dateTime', 'phenomenon1']].head())

df_phen['dateTime'] = pd.to_datetime(df_phen['dateTime'])
df_phen['next_dateTime'] = pd.to_datetime(df_phen['next_dateTime'])
df_phen['duration'] = (df_phen['next_dateTime'] - df_phen['dateTime']).dt.total_seconds() / 3600
print("\nDuraciones calculadas (horas):")
print(df_phen[['dateTime', 'next_dateTime', 'duration', 'phenomenon1']].head())
