using Microsoft.Data.Sqlite;

namespace CursorChatBrowser.Services;

public static class SqliteHelper
{
    public static List<(string Key, string Value)> QueryKv(string dbPath, string sql, params (string Name, object Value)[] parameters)
    {
        var results = new List<(string, string)>();
        using var conn = new SqliteConnection($"Data Source={dbPath};Mode=ReadOnly");
        conn.Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in parameters)
            cmd.Parameters.AddWithValue(name, value);

        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            var key = reader.IsDBNull(0) ? "" : reader.GetString(0);
            var val = reader.IsDBNull(1) ? "" : reader.GetString(1);
            results.Add((key, val));
        }
        return results;
    }

    public static string? QuerySingleValue(string dbPath, string sql, params (string Name, object Value)[] parameters)
    {
        using var conn = new SqliteConnection($"Data Source={dbPath};Mode=ReadOnly");
        conn.Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in parameters)
            cmd.Parameters.AddWithValue(name, value);

        using var reader = cmd.ExecuteReader();
        if (reader.Read() && !reader.IsDBNull(0))
            return reader.GetString(0);
        return null;
    }
}
