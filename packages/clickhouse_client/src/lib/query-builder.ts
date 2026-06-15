/**
 * Usage Example:
 *
 * const { query, params } = ClickHouseQueryBuilder.buildSelectQuery('events', {
 *   select: ['id', 'timestamp'],
 *   where: { status: 'active' },
 *   allowedTables: ['events'],
 *   allowedFields: ['id', 'timestamp', 'status']
 * });
 */

export interface WindowFunctionQueryOptions {
  select: string[];
  where?: Record<
    string,
    | string
    | number
    | boolean
    | Date
    | null
    | { operator: string; value: unknown }
  >;
  orderBy?: { field: string; direction: "ASC" | "DESC" }[];
  limit?: number;
  offset?: number;
  allowedTables?: readonly string[];
  allowedFields?: readonly string[];
}

export interface SubqueryOptions {
  select: string[];
  where?: Record<
    string,
    | string
    | number
    | boolean
    | Date
    | null
    | { operator: string; value: unknown }
  >;
  orderBy?: { field: string; direction: "ASC" | "DESC" }[];
  limit?: number;
  offset?: number;
}

/**
 * Secure ClickHouse Query Builder
 * Prevents SQL injection by using parameterized queries
 * Optimized for strict typing, maintainability, and security
 */
export class ClickHouseQueryBuilder {
  /**
   * Centralized validation for allowed tables and fields
   */
  private static validateAllowed(
    identifier: string,
    allowed: readonly string[] | undefined,
    type: "table" | "field"
  ): void {
    if (!this.isValidIdentifier(identifier)) {
      throw new Error(
        `[ClickHouseQueryBuilder] Invalid ${type} name: ${identifier}`
      );
    }
    if (allowed && allowed.length > 0 && !allowed.includes(identifier)) {
      throw new Error(
        `[ClickHouseQueryBuilder] Unauthorized ${type}: ${identifier}. Allowed: ${allowed.join(
          ", "
        )}`
      );
    }
  }
  /**
   * Build safe parameterized SELECT query for ClickHouse
   */
  static buildSelectQuery(
    table: string,
    options: {
      select?: string[] | undefined;
      where?:
        | Record<
            string,
            | string
            | number
            | boolean
            | Date
            | null
            | { operator: string; value: unknown }
          >
        | undefined;
      groupBy?: string[] | undefined;
      orderBy?: { field: string; direction: "ASC" | "DESC" }[] | undefined;
      limit?: number | undefined;
      offset?: number | undefined;
      allowedTables?: readonly string[] | undefined;
      allowedFields?: readonly string[] | undefined;
    } = {}
  ): { query: string; params: Record<string, unknown> } {
    const {
      select = ["*"],
      where = {},
      groupBy = [],
      orderBy = [],
      limit,
      offset,
      allowedTables = [],
      allowedFields = [],
    } = options;

    // Centralized table validation
    this.validateAllowed(table, allowedTables, "table");

    // Validate and build SELECT clause
    const selectClause = this.buildSelectClause(select, allowedFields);

    // Build WHERE clause with parameters
    const { whereClause, params } = this.buildWhereClause(where);

    // Build GROUP BY clause
    const groupByClause = this.buildGroupByClause(groupBy, allowedFields);

    // Build ORDER BY clause
    const orderByClause = this.buildOrderByClause(orderBy, allowedFields);

    // Build LIMIT and OFFSET
    const limitOffsetClause = this.buildLimitOffsetClause(limit, offset);

    // Construct final query
    let query = `SELECT ${selectClause} FROM ${this.escapeIdentifier(table)}`;

    if (whereClause) query += ` WHERE ${whereClause}`;
    if (groupByClause) query += ` GROUP BY ${groupByClause}`;
    if (orderByClause) query += ` ORDER BY ${orderByClause}`;
    if (limitOffsetClause) query += ` ${limitOffsetClause}`;

    return { query, params };
  }

  /**
   * Build safe INSERT query for ClickHouse
   */
  static buildInsertQuery(
    table: string,
    data: Record<string, unknown>[],
    options: {
      allowedTables?: readonly string[];
      allowedFields?: readonly string[];
    } = {}
  ): { table: string; data: Record<string, unknown>[] } {
    const { allowedTables = [], allowedFields = [] } = options;

    // Centralized table validation
    this.validateAllowed(table, allowedTables, "table");

    // Validate and sanitize data
    const sanitizedData = data.map((row) => {
      const sanitizedRow: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        this.validateAllowed(key, allowedFields, "field");
        sanitizedRow[key] = this.sanitizeValue(value);
      }
      return sanitizedRow;
    });

    return { table: this.escapeIdentifier(table), data: sanitizedData };
  }

  /**
   * Build safe aggregation query
   */
  /**
   * Build safe aggregation query
   */
  static buildAggregationQuery(
    table: string,
    aggregations: {
      field: string;
      function: "COUNT" | "SUM" | "AVG" | "MIN" | "MAX" | "STDDEV";
      alias?: string;
    }[],
    options: {
      where?:
        | Record<
            string,
            | string
            | number
            | boolean
            | Date
            | null
            | { operator: string; value: unknown }
          >
        | undefined;
      groupBy?: string[] | undefined;
      having?:
        | Record<
            string,
            | string
            | number
            | boolean
            | Date
            | null
            | { operator: string; value: unknown }
          >
        | undefined;
      allowedTables?: readonly string[] | undefined;
      allowedFields?: readonly string[] | undefined;
    } = {}
  ): { query: string; params: Record<string, unknown> } {
    const {
      where = {},
      groupBy = [],
      having = {},
      allowedTables = [],
      allowedFields = [],
    } = options;

    // Centralized table validation
    this.validateAllowed(table, allowedTables, "table");

    // Build aggregation SELECT clause
    const selectParts = aggregations.map((agg) => {
      this.validateAllowed(agg.field, allowedFields, "field");
      const alias = agg.alias ? ` AS ${this.escapeIdentifier(agg.alias)}` : "";
      return `${agg.function}(${this.escapeIdentifier(agg.field)})${alias}`;
    });

    const selectClause = selectParts.join(", ");

    // Build WHERE clause
    const { whereClause, params } = this.buildWhereClause(where);

    // Build GROUP BY clause
    const groupByClause = this.buildGroupByClause(groupBy, allowedFields);

    // Build HAVING clause
    const { whereClause: havingClause, params: havingParams } =
      this.buildWhereClause(having, "having_");

    // Merge parameters
    const allParams = { ...params, ...havingParams };

    // Construct query
    let query = `SELECT ${selectClause} FROM ${this.escapeIdentifier(table)}`;

    if (whereClause) query += ` WHERE ${whereClause}`;
    if (groupByClause) query += ` GROUP BY ${groupByClause}`;
    if (havingClause) query += ` HAVING ${havingClause}`;

    return { query, params: allParams };
  }

  /**
   * Build safe time-series query with date functions
   */

  static buildTimeSeriesQuery(
    table: string,
    dateField: string,
    interval: "minute" | "hour" | "day" | "week" | "month",
    options: {
      select?: string[] | undefined;
      where?:
        | Record<
            string,
            | string
            | number
            | boolean
            | Date
            | null
            | { operator: string; value: unknown }
          >
        | undefined;
      dateFrom?: string | Date | undefined;
      dateTo?: string | Date | undefined;
      allowedTables?: readonly string[] | undefined;
      allowedFields?: readonly string[] | undefined;
    } = {}
  ): { query: string; params: Record<string, unknown> } {
    const {
      select = ["*"],
      where = {},
      dateFrom,
      dateTo,
      allowedTables = [],
      allowedFields = [],
    } = options;

    // Centralized table/field validation
    this.validateAllowed(table, allowedTables, "table");
    this.validateAllowed(dateField, allowedFields, "field");

    // Build time interval function
    const intervalFunction = this.getIntervalFunction(interval, dateField);

    // Build SELECT clause with time grouping
    const selectClause = [
      `${intervalFunction} AS time_interval`,
      ...select
        .filter(
          (field) =>
            this.isValidIdentifier(field) &&
            (allowedFields.length === 0 || allowedFields.includes(field))
        )
        .map((field) => this.escapeIdentifier(field)),
    ].join(", ");

    // Add date range to WHERE conditions
    const whereWithDate = { ...where };
    if (dateFrom) {
      whereWithDate[`${dateField}_from`] = dateFrom;
    }
    if (dateTo) {
      whereWithDate[`${dateField}_to`] = dateTo;
    }

    // Build WHERE clause
    const { whereClause, params } = this.buildWhereClauseWithDateRange(
      whereWithDate,
      dateField
    );

    // Construct query
    let query = `SELECT ${selectClause} FROM ${this.escapeIdentifier(table)}`;
    if (whereClause) query += ` WHERE ${whereClause}`;
    query += ` GROUP BY time_interval ORDER BY time_interval`;
    return { query, params };
  }

  /**
   * Build query with window functions and computed fields
   * Example: SELECT value, avg(value) OVER (PARTITION BY name) AS avgValue FROM table
   */
  static buildWindowFunctionQuery(
    table: string,
    options: WindowFunctionQueryOptions
  ): { query: string; params: Record<string, unknown> } {
    const {
      select,
      where = {},
      orderBy = [],
      limit,
      offset,
      allowedTables = [],
      allowedFields = [],
    } = options;

    // Centralized table validation
    this.validateAllowed(table, allowedTables, "table");

    // Validate SELECT expressions (allow window functions and computed fields)
    if (!Array.isArray(select) || select.length === 0) {
      throw new Error("SELECT clause must be a non-empty array of expressions");
    }
    // For computed fields, skip strict identifier check, but validate allowedFields for base fields
    const selectClause = select.join(", ");

    // Build WHERE clause
    const { whereClause, params } = this.buildWhereClause(where);

    // Build ORDER BY clause
    const orderByClause = this.buildOrderByClause(orderBy, allowedFields);

    // Build LIMIT and OFFSET
    const limitOffsetClause = this.buildLimitOffsetClause(limit, offset);

    // Construct query
    let query = `SELECT ${selectClause} FROM ${this.escapeIdentifier(table)}`;
    if (whereClause) query += ` WHERE ${whereClause}`;
    if (orderByClause) query += ` ORDER BY ${orderByClause}`;
    if (limitOffsetClause) query += ` ${limitOffsetClause}`;

    return { query, params };
  }

  /**
   * Build query with subquery support
   * Example: SELECT * FROM (subquery) WHERE ...
   */
  static buildSubquery(
    subquery: string,
    options: SubqueryOptions
  ): { query: string; params: Record<string, unknown> } {
    const { select, where = {}, orderBy = [], limit, offset } = options;

    if (!subquery || typeof subquery !== "string") {
      throw new Error(
        "[ClickHouseQueryBuilder] Subquery must be a valid SQL string"
      );
    }
    if (!Array.isArray(select) || select.length === 0) {
      throw new Error(
        "[ClickHouseQueryBuilder] SELECT clause must be a non-empty array of expressions"
      );
    }
    const selectClause = select.join(", ");
    const { whereClause, params } = this.buildWhereClause(where);
    const orderByClause = this.buildOrderByClause(orderBy, []);
    const limitOffsetClause = this.buildLimitOffsetClause(limit, offset);
    let query = `SELECT ${selectClause} FROM (${subquery})`;
    if (whereClause) query += ` WHERE ${whereClause}`;
    if (orderByClause) query += ` ORDER BY ${orderByClause}`;
    if (limitOffsetClause) query += ` ${limitOffsetClause}`;
    return { query, params };
  }

  // === Private Helper Methods ===

  /**
   * Build SELECT clause - optimized for performance
   */
  private static buildSelectClause(
    select: string[],
    allowedFields: readonly string[]
  ): string {
    if (select.includes("*")) return "*";

    const hasAllowedFields = allowedFields && allowedFields.length > 0;
    const validFields: string[] = [];

    for (const field of select) {
      try {
        if (hasAllowedFields) {
          this.validateAllowed(field, allowedFields, "field");
        } else if (!this.isValidIdentifier(field)) {
          throw new Error(`Invalid field name: ${field}`);
        }
        validFields.push(field);
      } catch {
        // Skip invalid fields silently for performance
        continue;
      }
    }

    if (validFields.length === 0) {
      throw new Error(
        "[ClickHouseQueryBuilder] No valid fields specified in SELECT clause"
      );
    }

    return validFields.map((field) => this.escapeIdentifier(field)).join(", ");
  }

  /**
   * Build WHERE clause - optimized for performance
   */
  private static buildWhereClause(
    where: Record<
      string,
      | string
      | number
      | boolean
      | Date
      | null
      | { operator: string; value: unknown }
    > = {},
    paramPrefix = ""
  ): { whereClause: string; params: Record<string, unknown> } {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(where)) {
      if (!this.isValidIdentifier(key)) {
        throw new Error(`[ClickHouseQueryBuilder] Invalid field name: ${key}`);
      }

      const paramKey = `${paramPrefix}${key}`;

      if (Array.isArray(value)) {
        conditions.push(
          `${this.escapeIdentifier(key)} IN {${paramKey}:Array(String)}`
        );
        params[paramKey] = value.map((v) => this.sanitizeValue(v));
      } else if (value === null) {
        conditions.push(`${this.escapeIdentifier(key)} IS NULL`);
      } else if (
        typeof value === "object" &&
        value !== null &&
        "operator" in value &&
        "value" in value
      ) {
        const operator = this.validateOperator(
          (value as { operator: string }).operator
        );
        conditions.push(
          `${this.escapeIdentifier(key)} ${operator} {${paramKey}:String}`
        );
        params[paramKey] = this.sanitizeValue(
          (value as { value: unknown }).value
        );
      } else {
        conditions.push(`${this.escapeIdentifier(key)} = {${paramKey}:String}`);
        params[paramKey] = this.sanitizeValue(value);
      }
    }

    return {
      whereClause: conditions.length > 0 ? conditions.join(" AND ") : "",
      params,
    };
  }

  /**
   * Build WHERE clause with date range
   */
  private static buildWhereClauseWithDateRange(
    where: Record<
      string,
      | string
      | number
      | boolean
      | Date
      | null
      | { operator: string; value: unknown }
    > = {},
    dateField: string
  ): { whereClause: string; params: Record<string, unknown> } {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(where)) {
      if (key === `${dateField}_from`) {
        if (
          typeof value === "string" ||
          typeof value === "number" ||
          value instanceof Date
        ) {
          conditions.push(
            `${this.escapeIdentifier(dateField)} >= {dateFrom:DateTime}`
          );
          params["dateFrom"] = new Date(value).toISOString();
        }
      } else if (key === `${dateField}_to`) {
        if (
          typeof value === "string" ||
          typeof value === "number" ||
          value instanceof Date
        ) {
          conditions.push(
            `${this.escapeIdentifier(dateField)} <= {dateTo:DateTime}`
          );
          params["dateTo"] = new Date(value).toISOString();
        }
      } else if (this.isValidIdentifier(key)) {
        if (Array.isArray(value)) {
          conditions.push(
            `${this.escapeIdentifier(key)} IN {${key}:Array(String)}`
          );
          params[key] = value.map((v) => this.sanitizeValue(v));
        } else if (
          typeof value === "object" &&
          value !== null &&
          "operator" in value &&
          "value" in value
        ) {
          const operator = this.validateOperator(
            (value as { operator: string }).operator
          );
          conditions.push(
            `${this.escapeIdentifier(key)} ${operator} {${key}:String}`
          );
          params[key] = this.sanitizeValue((value as { value: unknown }).value);
        } else {
          conditions.push(`${this.escapeIdentifier(key)} = {${key}:String}`);
          params[key] = this.sanitizeValue(value);
        }
      }
    }

    return {
      whereClause: conditions.length > 0 ? conditions.join(" AND ") : "",
      params,
    };
  }

  /**
   * Build GROUP BY clause
   */
  private static buildGroupByClause(
    groupBy: string[],
    allowedFields: readonly string[]
  ): string {
    const validFields = groupBy.filter((field) => {
      try {
        this.validateAllowed(field, allowedFields, "field");
        return true;
      } catch {
        return false;
      }
    });
    return validFields.length > 0
      ? validFields.map((field) => this.escapeIdentifier(field)).join(", ")
      : "";
  }

  /**
   * Build ORDER BY clause
   */
  private static buildOrderByClause(
    orderBy: { field: string; direction: "ASC" | "DESC" }[],
    allowedFields: readonly string[]
  ): string {
    const validOrders = orderBy.filter((order) => {
      try {
        this.validateAllowed(order.field, allowedFields, "field");
        return ["ASC", "DESC"].includes(order.direction);
      } catch {
        return false;
      }
    });
    return validOrders.length > 0
      ? validOrders
          .map(
            (order) =>
              `${this.escapeIdentifier(order.field)} ${order.direction}`
          )
          .join(", ")
      : "";
  }

  /**
   * Build LIMIT and OFFSET clause
   */
  private static buildLimitOffsetClause(
    limit?: number,
    offset?: number
  ): string {
    const parts: string[] = [];
    if (limit !== undefined) {
      const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 100000); // Max 100k records
      parts.push(`LIMIT ${safeLimit}`);
    }
    if (offset !== undefined) {
      const safeOffset = Math.max(0, Math.floor(offset));
      parts.push(`OFFSET ${safeOffset}`);
    }
    return parts.join(" ");
  }

  /**
   * Get ClickHouse interval function for time-series queries
   */
  private static getIntervalFunction(
    interval: "minute" | "hour" | "day" | "week" | "month",
    dateField: string
  ): string {
    const escapedField = this.escapeIdentifier(dateField);
    switch (interval) {
      case "minute":
        return `toStartOfMinute(${escapedField})`;
      case "hour":
        return `toStartOfHour(${escapedField})`;
      case "day":
        return `toStartOfDay(${escapedField})`;
      case "week":
        return `toStartOfWeek(${escapedField})`;
      case "month":
        return `toStartOfMonth(${escapedField})`;
      default:
        throw new Error(
          `[ClickHouseQueryBuilder] Invalid time interval: ${interval}`
        );
    }
  }

  /**
   * Validate SQL identifier (table/field) - STRICT validation
   * Only allows alphanumeric characters and underscores, must start with letter or underscore
   */
  private static isValidIdentifier(identifier: string): boolean {
    return (
      /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier) && identifier.length <= 64
    );
  }

  /**
   * Escape SQL identifier
   */
  private static escapeIdentifier(identifier: string): string {
    if (!this.isValidIdentifier(identifier))
      throw new Error(
        `[ClickHouseQueryBuilder] Invalid identifier: ${identifier}`
      );
    return `"${identifier}"`;
  }

  /**
   * Validate SQL operator - STRICT whitelist
   */
  private static validateOperator(operator: string): string {
    const allowedOperators = [
      "=",
      "!=",
      "<>",
      ">",
      "<",
      ">=",
      "<=",
      "LIKE",
      "NOT LIKE",
      "ILIKE",
      "NOT ILIKE",
      "IN",
      "NOT IN",
      "IS",
      "IS NOT",
    ] as const;

    const upperOperator = operator.toUpperCase();
    if (
      !allowedOperators.includes(
        upperOperator as (typeof allowedOperators)[number]
      )
    ) {
      throw new Error(
        `[ClickHouseQueryBuilder] Invalid operator: ${operator}. Allowed: ${allowedOperators.join(
          ", "
        )}`
      );
    }
    return upperOperator;
  }

  /**
   * Sanitize value for SQL query - STRICT validation to prevent injection
   * Only allows primitive types and simple arrays
   */
  private static sanitizeValue(
    value: unknown
  ): string | number | boolean | null | (string | number | boolean | null)[] {
    if (value === null || value === undefined) return null;

    // Only allow primitive types
    if (typeof value === "string") {
      // Remove dangerous patterns, enforce max length, strip control chars
      let sanitized = value.replace(/[\0\b\n\r\tZ]/g, "");
      sanitized = sanitized.replace(/['"`]/g, "").trim();
      if (sanitized.length > 1024) sanitized = sanitized.slice(0, 1024);
      return sanitized;
    }

    if (typeof value === "number") {
      if (isNaN(value) || !isFinite(value)) return 0;
      return value;
    }

    if (typeof value === "boolean") return value;

    if (value instanceof Date) return value.toISOString();

    // Reject objects and complex types that could contain malicious code
    if (typeof value === "object") {
      throw new Error(
        "[ClickHouseQueryBuilder] Objects and complex types not allowed in queries"
      );
    }

    if (Array.isArray(value)) {
      // Only allow arrays of primitives
      const sanitizedArray: (string | number | boolean | null)[] = [];
      for (const v of value) {
        if (typeof v === "string") {
          sanitizedArray.push(this.sanitizeValue(v) as string);
        } else if (typeof v === "number") {
          sanitizedArray.push(this.sanitizeValue(v) as number);
        } else if (typeof v === "boolean") {
          sanitizedArray.push(v);
        } else if (v === null) {
          sanitizedArray.push(null);
        } else {
          throw new Error(
            "[ClickHouseQueryBuilder] Arrays can only contain primitives"
          );
        }
      }
      return sanitizedArray;
    }

    // Convert everything else to string as last resort
    return String(value).slice(0, 100);
  }
}