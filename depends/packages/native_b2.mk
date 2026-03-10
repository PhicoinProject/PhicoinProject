package=native_b2
$(package)_version=1_87_0
$(package)_download_path=https://archives.boost.io/release/1.87.0/source/
$(package)_file_name=boost_$($(package)_version).tar.gz
$(package)_sha256_hash=7b204c1cfa1a41f771361d23a99d3b4d5d677d7b52064eb73f37ba47b2d238bb
$(package)_build_subdir=tools/build/src/engine
ifneq (,$(findstring clang,$($(package)_cxx)))
$(package)_toolset_$(host_os)=clang
else
$(package)_toolset_$(host_os)=gcc
endif

define $(package)_build_cmds
  CXX="$($(package)_cxx)" CXXFLAGS="$($(package)_cxxflags)" ./build.sh "$($(package)_toolset_$(host_os))"
endef

define $(package)_stage_cmds
  mkdir -p "$($(package)_staging_prefix_dir)"/bin/ && \
  cp b2 "$($(package)_staging_prefix_dir)"/bin/
endef
