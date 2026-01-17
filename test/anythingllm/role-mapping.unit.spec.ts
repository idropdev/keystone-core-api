import { Test } from '@nestjs/testing';
import { AnythingLLMUserProvisioningService } from '../../src/anythingllm/provisioning/anythingllm-user-provisioning.service';
import { RoleEnum } from '../../src/roles/roles.enum';
import { AnythingLLMModule } from '../../src/anythingllm/anythingllm.module';

/**
 * Unit Tests for Role Mapping Function
 *
 * Tests the role mapping logic in isolation:
 * - Admin role mapping (RoleEnum.admin → 'admin')
 * - Manager role mapping (RoleEnum.manager → 'manager')
 * - User/default role mapping (RoleEnum.user → 'default')
 * - Edge cases: null, undefined, unknown values
 * - Type handling: numeric and string role IDs
 */
describe('Role Mapping Unit Tests', () => {
  let provisioningService: AnythingLLMUserProvisioningService;

  beforeAll(async () => {
    // Create a minimal test module
    const moduleRef = await Test.createTestingModule({
      imports: [AnythingLLMModule],
    }).compile();

    provisioningService = moduleRef.get<AnythingLLMUserProvisioningService>(
      AnythingLLMUserProvisioningService,
    );
  });

  describe('mapKeystoneRoleToAnythingLLMRole', () => {
    // Access the private method via reflection for testing
    const mapRole = (roleId: number | string | null | undefined): string => {
      // Use reflection to access private method
      // In TypeScript, we can access private methods via bracket notation
      return (provisioningService as any).mapKeystoneRoleToAnythingLLMRole(
        roleId,
      );
    };

    it('should map RoleEnum.admin (1) to "admin"', () => {
      const result = mapRole(RoleEnum.admin);
      expect(result).toBe('admin');
    });

    it('should map RoleEnum.manager (3) to "manager"', () => {
      const result = mapRole(RoleEnum.manager);
      expect(result).toBe('manager');
    });

    it('should map RoleEnum.user (2) to "default"', () => {
      const result = mapRole(RoleEnum.user);
      expect(result).toBe('default');
    });

    it('should map numeric admin role ID to "admin"', () => {
      const result = mapRole(1);
      expect(result).toBe('admin');
    });

    it('should map numeric manager role ID to "manager"', () => {
      const result = mapRole(3);
      expect(result).toBe('manager');
    });

    it('should map numeric user role ID to "default"', () => {
      const result = mapRole(2);
      expect(result).toBe('default');
    });

    it('should map string "1" to "admin"', () => {
      const result = mapRole('1');
      expect(result).toBe('admin');
    });

    it('should map string "3" to "manager"', () => {
      const result = mapRole('3');
      expect(result).toBe('manager');
    });

    it('should map string "2" to "default"', () => {
      const result = mapRole('2');
      expect(result).toBe('default');
    });

    it('should default to "default" for null role ID', () => {
      const result = mapRole(null);
      expect(result).toBe('default');
    });

    it('should default to "default" for undefined role ID', () => {
      const result = mapRole(undefined);
      expect(result).toBe('default');
    });

    it('should default to "default" for unknown numeric role ID', () => {
      const result = mapRole(999);
      expect(result).toBe('default');
    });

    it('should default to "default" for invalid string role ID', () => {
      const result = mapRole('invalid');
      expect(result).toBe('default');
    });

    it('should handle zero as unknown role (defaults to "default")', () => {
      const result = mapRole(0);
      expect(result).toBe('default');
    });

    it('should handle negative numbers as unknown role (defaults to "default")', () => {
      const result = mapRole(-1);
      expect(result).toBe('default');
    });

    it('should handle empty string as unknown role (defaults to "default")', () => {
      const result = mapRole('');
      expect(result).toBe('default');
    });

    it('should verify RoleEnum values match expected mapping', () => {
      // Verify enum values
      expect(RoleEnum.admin).toBe(1);
      expect(RoleEnum.manager).toBe(3);
      expect(RoleEnum.user).toBe(2);

      // Verify mapping
      expect(mapRole(RoleEnum.admin)).toBe('admin');
      expect(mapRole(RoleEnum.manager)).toBe('manager');
      expect(mapRole(RoleEnum.user)).toBe('default');
    });
  });

  describe('Role Mapping Integration', () => {
    it('should handle all valid role mappings correctly', () => {
      const roleMappings = [
        { input: RoleEnum.admin, expected: 'admin' },
        { input: RoleEnum.manager, expected: 'manager' },
        { input: RoleEnum.user, expected: 'default' },
        { input: 1, expected: 'admin' },
        { input: 3, expected: 'manager' },
        { input: 2, expected: 'default' },
        { input: '1', expected: 'admin' },
        { input: '3', expected: 'manager' },
        { input: '2', expected: 'default' },
        { input: null, expected: 'default' },
        { input: undefined, expected: 'default' },
      ];

      const mapRole = (roleId: number | string | null | undefined): string => {
        return (provisioningService as any).mapKeystoneRoleToAnythingLLMRole(
          roleId,
        );
      };

      roleMappings.forEach(({ input, expected }) => {
        const result = mapRole(input);
        expect(result).toBe(expected);
      });
    });
  });
});
