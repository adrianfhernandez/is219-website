interface Professor {
  id: string;
  name: string;
  school: string;
  avgRating: number;
  numRatings: number;
  avgDifficulty: number;
  wouldTakeAgain: number;
  department: string;
}

interface RMPSearchResult {
  professors: Professor[];
}

export class RateMyProfessorService {
  private baseUrl = 'https://www.ratemyprofessors.com/graphql';
  private defaultMaxResults = 150;
  private pageSize = 50;

  async searchProfessor(name: string, maxResults = this.defaultMaxResults, school?: string): Promise<RMPSearchResult> {
    try {
      const queryText = school && school.trim() ? `${name} ${school.trim()}` : name;
      const professors = await this.fetchTeachersPaged(queryText, maxResults);
      return { professors };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Error fetching from Rate My Professor:', message);
      return { professors: [] };
    }
  }

  private async fetchTeachersPaged(name: string, maxResults: number): Promise<Professor[]> {
    const collected: Professor[] = [];
    const seenIds = new Set<string>();
    let after: string | null = null;

    while (collected.length < maxResults) {
      const payload = this.buildSearchQueryPayload(name, after);

      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        console.error('RMP API Error:', response.statusText);
        break;
      }

      const data = await response.json() as unknown;
      const responseData = data as { errors?: unknown; data?: unknown };
      if (responseData.errors) {
        console.error('RMP API Error:', data.errors);
        break;
      }

      const pageProfessors = this.parseProfessors(data.data);
      for (const prof of pageProfessors) {
        if (!seenIds.has(prof.id)) {
          seenIds.add(prof.id);
          collected.push(prof);
          if (collected.length >= maxResults) break;
        }
      }

      const pageInfo = data?.data?.newSearch?.teachers?.pageInfo;
      if (!pageInfo?.hasNextPage || !pageInfo?.endCursor) {
        break;
      }

      after = String(pageInfo.endCursor);
    }

    return collected;
  }

  private buildSearchQueryPayload(name: string, after: string | null): { query: string; variables: Record<string, unknown> } {
    // Current RMP schema uses `newSearch` rather than `search`.
    const query = `
      query NewSearchTeachersQuery($query: TeacherSearchQuery!, $after: String) {
        newSearch {
          teachers(query: $query, first: ${this.pageSize}, after: $after) {
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              node {
                id
                firstName
                lastName
                department
                avgRating
                numRatings
                avgDifficulty
                wouldTakeAgainPercent
                school {
                  name
                }
              }
            }
          }
        }
      }
    `;

    return {
      query,
      variables: {
        query: {
          text: name
        },
        after
      }
    };
  }

  private parseProfessors(data: unknown): Professor[] {
    const professors: Professor[] = [];

    try {
      const maybeData = data as { newSearch?: { teachers?: { edges?: unknown } } };
      const edges = maybeData?.newSearch?.teachers?.edges;
      if (Array.isArray(edges)) {
        edges.forEach((edge) => {
          const prof = (edge as { node?: unknown }).node as Record<string, unknown> | undefined;
          if (prof && typeof prof.firstName === 'string' && typeof prof.lastName === 'string') {
            professors.push({
              id: String(prof.id),
              name: `${prof.firstName} ${prof.lastName}`,
              school: typeof prof.school === 'object' && prof.school !== null && 'name' in prof.school ? String((prof.school as Record<string, unknown>).name) : 'Unknown',
              avgRating: typeof prof.avgRating === 'number' ? prof.avgRating : 0,
              numRatings: typeof prof.numRatings === 'number' ? prof.numRatings : 0,
              avgDifficulty: typeof prof.avgDifficulty === 'number' ? prof.avgDifficulty : 0,
              wouldTakeAgain: typeof prof.wouldTakeAgainPercent === 'number' ? prof.wouldTakeAgainPercent : 0,
              department: typeof prof.department === 'string' ? prof.department : 'Unknown'
            });
          }
        });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Error parsing RMP response:', message);
    }

    return professors;
  }

  formatProfessorsForDisplay(professors: Professor[]): string {
    if (professors.length === 0) {
      return 'No professors found on Rate My Professor.';
    }

    let output = `\n📊 Rate My Professor Results:\n`;
    output += `${'-'.repeat(60)}\n`;

    professors.slice(0, 5).forEach((prof, index) => {
      output += `\n${index + 1}. ${prof.name}\n`;
      output += `   School: ${prof.school}\n`;
      output += `   Department: ${prof.department}\n`;
      output += `   Overall Rating: ⭐ ${prof.avgRating.toFixed(2)}/5.0 (${prof.numRatings} reviews)\n`;
      output += `   Difficulty: ${prof.avgDifficulty.toFixed(2)}/5.0\n`;
      output += `   Would Take Again: ${prof.wouldTakeAgain.toFixed(1)}%\n`;
    });

    output += `\n${'-'.repeat(60)}\n`;
    return output;
  }
}
